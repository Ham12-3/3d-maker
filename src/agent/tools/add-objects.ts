import { z } from "zod";
import { solvePlacements, type PlacementItem } from "@/layout/solver";
import { nextNodeId } from "@/scene/ops";
import {
  MaterialSchema,
  NodeIdSchema,
  PrimitiveShapeSchema,
  RelationSchema,
  SceneNodeSchema,
  Vec3Schema,
  type SceneNode,
  type Vec3,
} from "@/scene/schema";
import { SizeSchema } from "./common";
import { defineTool, fmt } from "./types";

const ObjectSpec = z.object({
  id: NodeIdSchema.optional().describe(
    "Optional readable id like 'red_box_1'. Use it when later objects in this call refer to this one.",
  ),
  name: z.string().min(1).max(60).describe("Short name, e.g. 'red box'"),
  shape: PrimitiveShapeSchema.describe("Primitive to build it from (real models arrive later)"),
  size: SizeSchema.optional().describe(
    "[width, height, depth] in metres, real-world scale. Default [1,1,1]",
  ),
  count: z.number().int().min(1).max(20).optional().describe("How many copies (default 1)"),
  material: MaterialSchema.optional(),
  tags: z.array(z.string()).max(8).optional().describe("e.g. ['furniture','wood']"),
  relations: z
    .array(RelationSchema)
    .max(4)
    .optional()
    .describe(
      "Where it goes, relative to other things. target is a node id, region id, 'pointer', 'camera' or 'origin'. " +
        "distance is an optional gap in metres.",
    ),
  region: z.string().optional().describe("Region id to scatter inside"),
  position: Vec3Schema.optional().describe(
    "Only if the user gave exact coordinates. Prefer relations.",
  ),
});

const input = z.object({ objects: z.array(ObjectSpec).min(1).max(12) });
type Spec = z.infer<typeof ObjectSpec>;

export const addObjectsTool = defineTool({
  name: "add_objects",
  pending: "Adding objects",
  eagerInputStreaming: true,
  description: [
    "Add one or more objects. Describe placement with relations (next_to, near, on_top_of, around, facing, left_of, in_front_of, inside_region...) or a region;",
    "a layout solver computes exact coordinates, snaps to the terrain and avoids overlaps. Do not invent coordinates.",
    "With no relations, objects go near the user's pointer (or the centre of the view).",
    "Objects may refer to ones earlier in the same call by id. Use count for several identical copies.",
    "Use real-world sizes in metres.",
    'Example: {"objects":[{"id":"blue_sphere_1","name":"blue sphere","shape":"sphere","size":[1.5,1.5,1.5],"material":{"color":"#3b6fd8"}},',
    '{"name":"red box","shape":"box","material":{"color":"#d64545"},"relations":[{"predicate":"next_to","target":"blue_sphere_1"}]}]}',
  ].join(" "),
  input,
  execute({ objects }, ctx) {
    const world = ctx.getWorld();
    const taken = new Set<string>();
    const idMap = new Map<string, string>();
    type Expanded = { spec: Spec; id: string; group: { index: number; size: number } };
    const expanded: Expanded[] = [];

    for (const spec of objects) {
      const count = spec.count ?? 1;
      for (let i = 0; i < count; i++) {
        const wanted = count === 1 && spec.id && !world.nodes[spec.id] && !taken.has(spec.id);
        const id = wanted ? spec.id! : nextNodeId(world, spec.id ?? spec.name, taken);
        taken.add(id);
        if (i === 0 && spec.id) idMap.set(spec.id, id);
        expanded.push({ spec, id, group: { index: i, size: count } });
      }
    }

    const remap = (target: string) => idMap.get(target) ?? target;
    const items: PlacementItem[] = expanded.map(({ spec, id, group }) => ({
      id,
      size: (spec.size ?? [1, 1, 1]) as Vec3,
      relations: (spec.relations ?? []).map((r) => ({ ...r, target: remap(r.target) })),
      region: spec.region,
      position: spec.position as Vec3 | undefined,
      group,
    }));

    const placements = new Map(
      solvePlacements(world, dependencyOrder(items), {
        pointer: ctx.pointer,
        camera: ctx.camera,
        seed: ctx.seed,
      }).map((p) => [p.id, p]),
    );

    const nodes: SceneNode[] = [];
    for (const [i, { spec, id }] of expanded.entries()) {
      const item = items[i]!;
      const placement = placements.get(id)!;
      const node: SceneNode = {
        id,
        name: spec.name,
        kind: "primitive",
        primitive: spec.shape,
        transform: { position: placement.position, rotation: placement.rotation, scale: item.size },
        ...(spec.material ? { material: spec.material } : {}),
        relations: item.relations,
        tags: [...new Set([...(spec.tags ?? []), spec.shape])],
        createdBy: "agent",
      };
      const valid = SceneNodeSchema.safeParse(node);
      if (!valid.success)
        return {
          ok: false,
          error: `Invalid object "${spec.name}": ${z.prettifyError(valid.error)}`,
        };
      nodes.push(valid.data);
    }

    ctx.edit(`Add ${nodes.length} object(s)`, (draft) => {
      for (const node of nodes) draft.nodes[node.id] = node;
    });

    const lines = nodes.map((n) => {
      const p = placements.get(n.id)!;
      const issues = p.unsatisfied.length
        ? ` (could not satisfy: ${p.unsatisfied.join("; ")})`
        : "";
      return `${n.id} "${n.name}" at ${fmt(n.transform.position)} size ${n.transform.scale.join("x")}m${issues}`;
    });
    const names = [
      ...new Set(objects.map((o) => ((o.count ?? 1) > 1 ? `${o.count} ${o.name}` : o.name))),
    ];
    return {
      ok: true,
      activity: `Added ${names.join(", ")}`,
      result: `Added:\n${lines.join("\n")}`,
    };
  },
});

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
