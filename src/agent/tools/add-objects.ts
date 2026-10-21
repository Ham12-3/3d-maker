import { z } from "zod";
import { getKitModel } from "@/assets/catalog";
import { toAssetRef, type AssetCandidate } from "@/assets/types";
import { solvePlacements, type PlacementItem } from "@/layout/solver";
import { nextNodeId } from "@/scene/ops";
import {
  MaterialSchema,
  NodeIdSchema,
  PrimitiveShapeSchema,
  RelationSchema,
  SceneNodeSchema,
  Vec3Schema,
  type PrimitiveShape,
  type SceneNode,
  type Vec3,
} from "@/scene/schema";
import { SizeSchema } from "./common";
import { defineTool, fmt, type ToolContext } from "./types";

const ObjectSpec = z.object({
  id: NodeIdSchema.optional().describe(
    "Optional readable id like 'cabin_1'. Use it when later objects in this call refer to this one.",
  ),
  name: z.string().min(1).max(60).describe("Short name, e.g. 'wooden cabin'"),
  asset_query: z
    .string()
    .min(2)
    .max(60)
    .optional()
    .describe(
      "What real 3D model to use, 1-3 words, e.g. 'log cabin', 'pine tree', 'lantern'. Preferred for real things.",
    ),
  asset_id: z
    .string()
    .optional()
    .describe("Exact model from search_assets, e.g. 'kenney:tent' or 'polypizza:52s3JpUSjmX'"),
  shape: PrimitiveShapeSchema.optional().describe(
    "Primitive to use instead of a model (abstract shapes), or the fallback if no model is found",
  ),
  size: SizeSchema.optional().describe(
    "[width, height, depth] in metres, real-world scale. Models keep their proportions and fit this height.",
  ),
  count: z.number().int().min(1).max(20).optional().describe("How many copies (default 1)"),
  material: MaterialSchema.optional().describe("Primitives only"),
  tags: z.array(z.string()).max(8).optional().describe("e.g. ['furniture','wood']"),
  relations: z
    .array(RelationSchema)
    .max(4)
    .optional()
    .describe(
      "Where it goes, relative to other things. target is a node id, region id, 'pointer', 'camera' or 'origin'. " +
        "distance is an optional gap in metres.",
    ),
  region: z.string().optional().describe("Region or feature id to scatter inside"),
  position: Vec3Schema.optional().describe(
    "Only if the user gave exact coordinates. Prefer relations.",
  ),
});

const input = z.object({ objects: z.array(ObjectSpec).min(1).max(12) });
type Spec = z.infer<typeof ObjectSpec>;

const DEFAULT_MODEL_SIZE: Vec3 = [2, 2, 2];
const AQUATIC = new Set(["boat", "canoe", "kayak", "raft", "lily", "water", "duck"]);

type Resolved =
  | { kind: "asset"; candidate: AssetCandidate; note?: string }
  | { kind: "primitive"; shape: PrimitiveShape; note?: string };

export const addObjectsTool = defineTool({
  name: "add_objects",
  pending: "Adding objects",
  eagerInputStreaming: true,
  description: [
    "Add one or more objects. For real things (cabin, tree, bench, lantern, boat...) give asset_query and a realistic size;",
    "a low-poly model is found automatically (bundled kit first, then an online library). Use shape for abstract primitives.",
    "Describe placement with relations (next_to, near, on_top_of, around, facing, left_of, in_front_of, along_edge_of, inside_region...) or a region;",
    "a layout solver computes exact coordinates, snaps to the terrain, keeps land things out of lakes and avoids overlaps. Do not invent coordinates.",
    "With no relations, objects go near the user's pointer (or the centre of the view).",
    "Objects may refer to ones earlier in the same call by id. Use count for several identical copies (for more than ~10 natural things use add_procedural).",
    'Example: {"objects":[{"id":"cabin_1","name":"wooden cabin","asset_query":"log cabin","size":[6,4.5,5],',
    '"relations":[{"predicate":"near","target":"lake_1","distance":3},{"predicate":"facing","target":"lake_1"}]}]}',
  ].join(" "),
  input,
  async execute({ objects }, ctx) {
    const resolved = await Promise.all(objects.map((spec) => resolveSpec(spec, ctx)));
    const world = ctx.getWorld();
    const taken = new Set<string>();
    const idMap = new Map<string, string>();
    type Expanded = {
      spec: Spec;
      res: Resolved;
      id: string;
      group: { index: number; size: number };
    };
    const expanded: Expanded[] = [];

    objects.forEach((spec, s) => {
      const count = spec.count ?? 1;
      for (let i = 0; i < count; i++) {
        const wanted = count === 1 && spec.id && !world.nodes[spec.id] && !taken.has(spec.id);
        const id = wanted ? spec.id! : nextNodeId(world, spec.id ?? spec.name, taken);
        taken.add(id);
        if (i === 0 && spec.id) idMap.set(spec.id, id);
        expanded.push({ spec, res: resolved[s]!, id, group: { index: i, size: count } });
      }
    });

    const remap = (target: string) => idMap.get(target) ?? target;
    const items: PlacementItem[] = expanded.map(({ spec, res, id, group }) => ({
      id,
      size: sizeFor(spec, res),
      relations: (spec.relations ?? []).map((r) => ({ ...r, target: remap(r.target) })),
      region: spec.region ? remap(spec.region) : undefined,
      position: spec.position as Vec3 | undefined,
      group,
      aquatic: [...(spec.tags ?? []), ...(res.kind === "asset" ? res.candidate.tags : [])].some(
        (t) => AQUATIC.has(t),
      ),
    }));

    const placements = new Map(
      solvePlacements(world, dependencyOrder(items), {
        pointer: ctx.pointer,
        camera: ctx.camera,
        seed: ctx.seed,
      }).map((p) => [p.id, p]),
    );

    const nodes: SceneNode[] = [];
    for (const [i, { spec, res, id }] of expanded.entries()) {
      const item = items[i]!;
      const placement = placements.get(id)!;
      const base = {
        id,
        name: spec.name,
        transform: { position: placement.position, rotation: placement.rotation, scale: item.size },
        relations: item.relations,
        createdBy: "agent" as const,
      };
      const node: SceneNode =
        res.kind === "asset"
          ? {
              ...base,
              kind: "asset",
              asset: toAssetRef(res.candidate),
              tags: [...new Set([...(spec.tags ?? []), ...res.candidate.tags.slice(0, 4)])],
            }
          : {
              ...base,
              kind: "primitive",
              primitive: res.shape,
              ...(spec.material ? { material: spec.material } : {}),
              tags: [...new Set([...(spec.tags ?? []), res.shape])],
            };
      const valid = SceneNodeSchema.safeParse(node);
      if (!valid.success) {
        return {
          ok: false,
          error: `Invalid object "${spec.name}": ${z.prettifyError(valid.error)}`,
        };
      }
      nodes.push(valid.data);
    }

    ctx.edit(`Add ${nodes.length} object(s)`, (draft) => {
      for (const node of nodes) draft.nodes[node.id] = node;
    });

    const lines = expanded.map(({ res, id }) => {
      const n = nodes.find((x) => x.id === id)!;
      const p = placements.get(id)!;
      const source =
        res.kind === "asset"
          ? ` model "${res.candidate.name}" (${res.candidate.source}, ${res.candidate.license})`
          : ` ${res.shape}`;
      const issues = p.unsatisfied.length
        ? ` (could not satisfy: ${p.unsatisfied.join("; ")})`
        : "";
      const note = res.note ? ` NOTE: ${res.note}` : "";
      return `${id} "${n.name}"${source} at ${fmt(n.transform.position)} size ${n.transform.scale.map((v) => +v.toFixed(2)).join("x")}m${issues}${note}`;
    });
    const names = [
      ...new Set(objects.map((o) => ((o.count ?? 1) > 1 ? `${o.count} ${o.name}` : o.name))),
    ];
    return {
      ok: true,
      activity: `Added ${names.join(", ")}`,
      result: `Added:\n${[...new Set(lines)].join("\n")}`,
    };
  },
});

async function resolveSpec(spec: Spec, ctx: ToolContext): Promise<Resolved> {
  if (spec.asset_id) {
    const c = ctx.candidates.get(spec.asset_id) ?? kitCandidate(spec.asset_id);
    if (c) return { kind: "asset", candidate: c };
  }
  if (spec.asset_query) {
    const found = await ctx.searchAssets(spec.asset_query).catch(() => []);
    for (const c of found) ctx.candidates.set(`${c.source}:${c.id}`, c);
    if (found[0]) return { kind: "asset", candidate: found[0] };
  }
  if (spec.shape) return { kind: "primitive", shape: spec.shape };
  const wanted = spec.asset_query ?? spec.asset_id ?? spec.name;
  return { kind: "primitive", shape: "box", note: `no model found for "${wanted}", used a box` };
}

function kitCandidate(assetId: string): AssetCandidate | undefined {
  const m = getKitModel(assetId.replace(/^kenney:/, ""));
  if (!m) return undefined;
  return {
    source: "kenney",
    id: m.id,
    name: m.name,
    url: m.url,
    license: "CC0",
    size: m.size as Vec3,
    tags: m.tags,
    score: 1,
  };
}

/**
 * The node's size box. Bundled models have known proportions, so they keep
 * them and match the requested height; online models fit the requested box.
 */
function sizeFor(spec: Spec, res: Resolved): Vec3 {
  if (res.kind === "primitive") return (spec.size ?? [1, 1, 1]) as Vec3;
  const known = res.candidate.size;
  if (known) {
    const k = spec.size ? spec.size[1] / known[1] : 1;
    return [known[0] * k, known[1] * k, known[2] * k].map((v) => Math.round(v * 100) / 100) as Vec3;
  }
  return (spec.size ?? DEFAULT_MODEL_SIZE) as Vec3;
}

/** Place targets before the objects that refer to them (stable for everything else). */
function dependencyOrder(items: PlacementItem[]): PlacementItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const out: PlacementItem[] = [];
  const visit = (item: PlacementItem) => {
    if (done.has(item.id) || visiting.has(item.id)) return;
    visiting.add(item.id);
    for (const rel of item.relations) {
      const dep = byId.get(rel.target);
      if (dep) visit(dep);
    }
    visiting.delete(item.id);
    done.add(item.id);
    out.push(item);
  };
  items.forEach(visit);
  return out;
}
