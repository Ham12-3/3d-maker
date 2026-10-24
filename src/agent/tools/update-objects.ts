import { z } from "zod";
import { followMovedAnchors, nodeSize, solvePlacements } from "@/layout/solver";
import { partsFrame } from "@/scene/parts";
import { MaterialSchema, PartSchema, RelationSchema, Vec3Schema, type Vec3 } from "@/scene/schema";
import { getWorldHeightField } from "@/scene/terrain";
import { SelectorFields, SizeSchema, resolveSelector } from "./common";
import { defineTool, fail, fmt } from "./types";

const input = z.object({
  ...SelectorFields,
  changes: z.object({
    relations: z
      .array(RelationSchema)
      .max(4)
      .optional()
      .describe(
        "New placement relations; the solver re-places the objects. Preferred over coordinates.",
      ),
    move_by: Vec3Schema.optional().describe("Relative move in metres [x, y, z]"),
    position: Vec3Schema.optional().describe(
      "Absolute position; only when the user gave coordinates",
    ),
    rotate_y_degrees: z
      .number()
      .optional()
      .describe("Turn around the vertical axis by this many degrees"),
    size: SizeSchema.optional(),
    scale_by: z
      .number()
      .positive()
      .max(20)
      .optional()
      .describe("Multiply size, e.g. 1.5 = 50% bigger"),
    material: MaterialSchema.optional().describe(
      "Merged into the current material. On models and custom objects, color tints the whole object",
    ),
    parts: z
      .array(PartSchema)
      .min(1)
      .max(40)
      .optional()
      .describe(
        "Custom objects only: the complete redesigned parts list (e.g. to recolour just the roof, send all parts with the roof changed). Keeps the object's height.",
      ),
    name: z.string().min(1).max(60).optional(),
    add_tags: z.array(z.string()).max(8).optional(),
    remove_tags: z.array(z.string()).max(8).optional(),
  }),
});

export const updateObjectsTool = defineTool({
  name: "update_objects",
  pending: "Updating objects",
  description: [
    "Change existing objects, selected by ids and/or tag: move, re-place with new relations, rotate, resize, recolour, rename, retag.",
    "'this'/'it' usually means the SELECTION id from the scene summary. 'there' means relations to target 'pointer'.",
    "Things placed on or next to a moved object follow it automatically.",
    'Examples: make this bigger => {"ids":["rock_2"],"changes":{"scale_by":1.5}};',
    'move the box next to the pillar => {"ids":["box_1"],"changes":{"relations":[{"predicate":"next_to","target":"pillar_1"}]}}.',
  ].join(" "),
  input,
  execute({ ids, tag, changes }, ctx) {
    const world = ctx.getWorld();
    const sel = resolveSelector(world, { ids, tag });
    if (sel.ids.length === 0) {
      return fail(
        sel.unknown.length ? `Unknown ids: ${sel.unknown.join(", ")}` : "Nothing matched ids/tag.",
      );
    }

    const placements = changes.relations
      ? new Map(
          solvePlacements(
            // Solve against the world without the objects being moved, so they don't block themselves.
            {
              ...world,
              nodes: Object.fromEntries(
                Object.entries(world.nodes).filter(([id]) => !sel.ids.includes(id)),
              ),
            },
            sel.ids.map((id, index) => ({
              id,
              size: nodeSize(world.nodes[id]!),
              relations: changes.relations!,
              group: { index, size: sel.ids.length },
            })),
            { pointer: ctx.pointer, camera: ctx.camera, seed: ctx.seed },
          ).map((p) => [p.id, p]),
        )
      : null;

    const before = new Map(sel.ids.map((id) => [id, world.nodes[id]!.transform.position]));
    let followed: string[] = [];

    ctx.edit(`Update ${sel.ids.join(", ")}`, (draft) => {
      const heightAt = getWorldHeightField(draft);
      for (const id of sel.ids) {
        const node = draft.nodes[id]!;
        const t = node.transform;
        const placement = placements?.get(id);
        if (placement) {
          t.position = placement.position;
          t.rotation = placement.rotation;
          node.relations = changes.relations!;
        }
        if (changes.position) {
          const [x, y, z] = changes.position;
          t.position = [x, Math.max(y, heightAt(x, z)), z];
          node.relations = node.relations.filter((r) => r.predicate === "facing");
        }
        if (changes.move_by) {
          const [dx, dy, dz] = changes.move_by;
          const [x, y, z] = [t.position[0] + dx, t.position[1] + dy, t.position[2] + dz];
          const stacked = node.relations.some((r) => r.predicate === "on_top_of");
          // Grounded objects stay on the terrain unless explicitly lifted.
          t.position = [x, stacked ? y : heightAt(x, z) + Math.max(0, dy), z];
        }
        if (changes.rotate_y_degrees !== undefined) {
          t.rotation = [
            t.rotation[0],
            t.rotation[1] + (changes.rotate_y_degrees * Math.PI) / 180,
            t.rotation[2],
          ];
        }
        if (changes.size || changes.scale_by) {
          const k = changes.scale_by ?? 1;
          const next = (changes.size ?? t.scale.map((s) => s * k)) as Vec3;
          if (node.bounds && changes.scale_by) node.bounds = node.bounds.map((b) => b * k) as Vec3;
          t.scale = next;
        }
        if (changes.material) node.material = { ...node.material, ...changes.material };
        if (changes.parts && node.kind === "group") {
          // Same height as before, new proportions from the new design.
          const natural = partsFrame(changes.parts).size;
          const k = t.scale[1] / natural[1];
          node.parts = changes.parts;
          t.scale = natural.map((v) => +(v * k).toFixed(2)) as Vec3;
        }
        if (changes.name) node.name = changes.name;
        if (changes.add_tags || changes.remove_tags) {
          const tags = new Set([...node.tags, ...(changes.add_tags ?? [])]);
          for (const tagName of changes.remove_tags ?? []) tags.delete(tagName);
          node.tags = [...tags];
        }
      }
      followed = followMovedAnchors(draft, sel.ids, before);
    });

    const after = ctx.getWorld();
    const lines = sel.ids.map((id) => {
      const n = after.nodes[id]!;
      const p = placements?.get(id);
      const issues = p?.unsatisfied.length
        ? ` (could not satisfy: ${p.unsatisfied.join("; ")})`
        : "";
      return `${id} at ${fmt(n.transform.position)} size ${n.transform.scale.map((s) => +s.toFixed(2)).join("x")}m${issues}`;
    });
    if (followed.length) lines.push(`Followed along: ${followed.join(", ")}`);
    if (sel.unknown.length) lines.push(`Ignored unknown ids: ${sel.unknown.join(", ")}`);
    return { ok: true, activity: `Updated ${sel.ids.length} object(s)`, result: lines.join("\n") };
  },
});
