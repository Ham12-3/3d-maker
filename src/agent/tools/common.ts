import { z } from "zod";
import { nodeSize } from "@/layout/solver";
import { regionRadius } from "@/layout/regions";
import type { Focus } from "@/render/camera/shots";
import type { World } from "@/scene/schema";
import { getWorldHeightField } from "@/scene/terrain";
import type { ToolContext } from "./types";

export const SizeSchema = z
  .tuple([
    z.number().positive().max(200),
    z.number().positive().max(200),
    z.number().positive().max(200),
  ])
  .describe("[width, height, depth] in metres");

export const SelectorFields = {
  ids: z.array(z.string()).max(50).optional().describe("Node ids, e.g. ['cabin_1']"),
  tag: z.string().optional().describe("Select every node with this tag, e.g. 'tree'"),
};

/** Resolve ids/tag to existing node ids. Returns unknown ids separately. */
export function resolveSelector(world: World, sel: { ids?: string[]; tag?: string }) {
  const found = new Set<string>();
  const unknown: string[] = [];
  for (const id of sel.ids ?? []) {
    if (world.nodes[id]) found.add(id);
    else unknown.push(id);
  }
  if (sel.tag) {
    for (const node of Object.values(world.nodes))
      if (node.tags.includes(sel.tag)) found.add(node.id);
  }
  return { ids: [...found], unknown };
}

/** What a camera shot should look at: a node, region, the pointer, or the whole scene. */
export function focusFor(target: string | undefined, ctx: ToolContext): Focus | string {
  const world = ctx.getWorld();
  const heightAt = getWorldHeightField(world);
  const id = target === "scene" ? undefined : (target ?? ctx.selection ?? undefined);

  if (id === "pointer" || id === "there") {
    const p = ctx.pointer ?? ctx.camera.target;
    return { center: [p[0], heightAt(p[0], p[2]), p[2]], radius: 3, height: 2 };
  }
  if (id === "origin") return { center: [0, 0, 0], radius: 5, height: 2 };
  if (id) {
    const node = world.nodes[id];
    if (node) {
      const size = nodeSize(node);
      return {
        center: node.transform.position,
        radius: Math.max(size[0], size[2]) / 2,
        height: size[1],
      };
    }
    const region = world.regions[id];
    if (region) {
      return {
        center: [region.center[0], heightAt(region.center[0], region.center[2]), region.center[2]],
        radius: regionRadius(region),
        height: 2,
      };
    }
    if (target) return `Unknown camera target "${target}"`;
  }

  // Whole scene: bounding circle of every node's extent (a forest ring is
  // 80 m across even though its centre is one point).
  const nodes = Object.values(world.nodes);
  if (nodes.length === 0) return { center: [0, 0, 0], radius: 12, height: 3 };
  const half = (n: (typeof nodes)[number]) => Math.max(nodeSize(n)[0], nodeSize(n)[2]) / 2;
  const xs = nodes.flatMap((n) => [
    n.transform.position[0] - half(n),
    n.transform.position[0] + half(n),
  ]);
  const zs = nodes.flatMap((n) => [
    n.transform.position[2] - half(n),
    n.transform.position[2] + half(n),
  ]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const radius = Math.max(
    ...nodes.map(
      (n) => Math.hypot(n.transform.position[0] - cx, n.transform.position[2] - cz) + half(n),
    ),
  );
  const height = Math.max(...nodes.map((n) => nodeSize(n)[1]));
  return { center: [cx, heightAt(cx, cz), cz], radius: Math.min(Math.max(radius, 4), 60), height };
}
