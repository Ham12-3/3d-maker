import { create } from "zustand";
import { z } from "zod";
import { searchKit } from "@/assets/catalog";
import { solvePlacements, type PlacementItem } from "@/layout/solver";
import { patchEnvironment } from "@/scene/ops";
import { RelationSchema, type Vec3 } from "@/scene/schema";
import { planFeatureArea } from "./tools/add-procedural";
import { getTool } from "./tools";
import type { ToolContext } from "./tools/types";

/**
 * Streaming previews. Tool inputs stream in token by token
 * (eager_input_streaming); the parts that have finished arriving are shown
 * before the tool call completes:
 * - set_environment: finished fields are applied (the sky starts turning).
 * - add_objects / add_procedural: ghost placeholders at the solved spots.
 * The real tool run then replaces the ghosts with the real thing.
 */

export type Ghost = {
  key: string;
  shape: "box" | "disc" | "ring";
  position: Vec3;
  /** Box size, or [outer diameter, height, outer diameter] for discs and rings. */
  size: Vec3;
  inner?: number;
  color: string;
};

export const useGhosts = create<{ ghosts: Ghost[] }>()(() => ({ ghosts: [] }));

/**
 * The part of a streamed value that can't change any more: for an object
 * every key but the last, for an array every element but the last.
 */
export function stablePart(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, -1);
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return Object.fromEntries(entries.slice(0, -1));
  }
  return undefined;
}

const FEATURE_COLORS: Record<string, string> = {
  lake: "#4aa3d8",
  forest: "#5fbf6f",
  rocks: "#b9b2a5",
  grass: "#8fd17a",
  flowers: "#f2a7d0",
  fireflies: "#ffe27a",
};

const PartialObject = z.looseObject({
  id: z.string().optional(),
  name: z.string().min(1),
  asset_query: z.string().optional(),
  shape: z.string().optional(),
  size: z.tuple([z.number(), z.number(), z.number()]).optional(),
  count: z.number().int().min(1).max(20).optional(),
  relations: z.array(RelationSchema).optional(),
  region: z.string().optional(),
});

const PartialFeature = z.looseObject({
  type: z.enum(["forest", "rocks", "grass", "flowers", "lake", "fireflies"]),
  radius: z.number().min(1).max(60).optional(),
  relations: z.array(RelationSchema).optional(),
  region: z.string().optional(),
});

export class StreamPreview {
  private readonly lastKey = new Map<string, string>();
  private readonly byBlock = new Map<string, Ghost[]>();

  constructor(
    private readonly ctx: ToolContext,
    /** Called the first time anything becomes visible. */
    private readonly onVisible: () => void,
  ) {}

  /** Feed the latest parsed snapshot of a streaming tool_use block. */
  update(blockId: string, tool: string, snapshot: unknown): void {
    if (!snapshot || typeof snapshot !== "object") return;
    // Only recompute when the finished part of the input changed.
    const finished =
      tool === "add_objects"
        ? stablePart((snapshot as { objects?: unknown }).objects ?? [])
        : stablePart(snapshot);
    const key = JSON.stringify(finished);
    if (key === this.lastKey.get(blockId)) return;
    this.lastKey.set(blockId, key);
    try {
      if (tool === "set_environment") this.previewEnvironment(finished);
      else if (tool === "add_objects")
        this.previewObjects(blockId, snapshot as { objects?: unknown[] });
      else if (tool === "add_procedural")
        this.previewFeature(blockId, snapshot as Record<string, unknown>);
    } catch {
      // Previews are best effort; the real tool run is what counts.
    }
  }

  /** The block's tool ran: its ghosts give way to the real nodes. */
  clearBlock(blockId: string): void {
    if (this.byBlock.delete(blockId)) this.publish();
  }

  clearAll(): void {
    this.byBlock.clear();
    this.publish();
  }

  private previewEnvironment(stable: unknown): void {
    const input = getTool("set_environment")!.input;
    const parsed = input.safeParse(stable);
    if (!parsed.success || Object.keys(parsed.data as object).length === 0) return;
    this.ctx.edit(
      "Preview environment",
      patchEnvironment(parsed.data as Parameters<typeof patchEnvironment>[0]),
    );
    this.onVisible();
  }

  private previewObjects(blockId: string, snapshot: { objects?: unknown[] }): void {
    const done = (Array.isArray(snapshot.objects) ? snapshot.objects.slice(0, -1) : [])
      .map((o) => PartialObject.safeParse(o))
      .flatMap((r) => (r.success ? [r.data] : []));
    if (done.length === 0) return;

    const world = this.ctx.getWorld();
    const items: PlacementItem[] = done.flatMap((spec, s) =>
      Array.from({ length: spec.count ?? 1 }, (_, i) => ({
        id: `${spec.id ?? `ghost_${s}`}_${i}`,
        size: ghostSize(spec),
        relations: spec.relations ?? [],
        region: spec.region,
        group: { index: i, size: spec.count ?? 1 },
      })),
    );
    // Relations to ids created earlier in the same call point at ghost ids.
    const alias = new Map(
      done.flatMap((spec, s) =>
        spec.id ? [[spec.id, `${spec.id}_0`] as const] : [[`ghost_${s}`, `ghost_${s}_0`] as const],
      ),
    );
    for (const item of items)
      item.relations = item.relations.map((r) => ({
        ...r,
        target: alias.get(r.target) ?? r.target,
      }));

    const placements = solvePlacements(world, items, {
      pointer: this.ctx.pointer,
      camera: this.ctx.camera,
      seed: this.ctx.seed,
    });
    this.byBlock.set(
      blockId,
      placements.map((p, i) => ({
        key: `${blockId}:${p.id}`,
        shape: "box",
        position: p.position,
        size: items[i]!.size,
        color: "#9fd3ff",
      })),
    );
    this.publish();
    this.onVisible();
  }

  private previewFeature(blockId: string, snapshot: Record<string, unknown>): void {
    // Wait until the type is complete (some later key has started).
    if (!("type" in (stablePart(snapshot) as object))) return;
    const parsed = PartialFeature.safeParse(stablePart(snapshot));
    if (!parsed.success) return;
    const area = planFeatureArea(this.ctx.getWorld(), parsed.data, `preview_${blockId}`, this.ctx);
    if (typeof area === "string") return;
    const type = parsed.data.type;
    this.byBlock.set(blockId, [
      {
        key: `${blockId}:${type}`,
        shape: area.inner ? "ring" : "disc",
        position: area.center,
        size: [area.outer * 2, 0.2, area.outer * 2],
        ...(area.inner ? { inner: area.inner } : {}),
        color: FEATURE_COLORS[type] ?? "#9fd3ff",
      },
    ]);
    this.publish();
    this.onVisible();
  }

  private publish(): void {
    useGhosts.setState({ ghosts: [...this.byBlock.values()].flat() });
  }
}

function ghostSize(spec: z.infer<typeof PartialObject>): Vec3 {
  const kit = spec.asset_query ? searchKit(spec.asset_query, 1)[0]?.size : undefined;
  if (kit) {
    const k = spec.size ? spec.size[1] / kit[1] : 1;
    return [kit[0] * k, kit[1] * k, kit[2] * k];
  }
  return (spec.size ?? (spec.asset_query ? [2, 2, 2] : [1, 1, 1])) as Vec3;
}
