import { z } from "zod";
import { solvePlacements } from "@/layout/solver";
import { NodeIdSchema, RelationSchema, type Region } from "@/scene/schema";
import { defineTool, fail, fmt } from "./types";

const input = z.object({
  id: NodeIdSchema.describe("Readable name, e.g. 'village_square', 'north_clearing'"),
  shape: z.enum(["circle", "rect", "ring"]).optional().describe("Default circle"),
  size: z
    .tuple([z.number().positive().max(200), z.number().positive().max(200)])
    .optional()
    .describe(
      "circle: [diameter, diameter]; rect: [width, depth]; ring: [outer diameter, inner diameter]. Default [16, 16]",
    ),
  relations: z
    .array(RelationSchema)
    .max(3)
    .optional()
    .describe("Where its centre goes; default the pointer / view centre"),
});

export const createRegionTool = defineTool({
  name: "create_region",
  pending: "Marking out an area",
  description:
    "Name an area so later commands can use it ('the clearing', 'the village square'). Regions are invisible; " +
    "objects and features can then use inside_region / along_edge_of with the region id.",
  input,
  execute({ id, shape = "circle", size, relations = [] }, ctx) {
    const world = ctx.getWorld();
    if (world.regions[id] || world.nodes[id]) return fail(`"${id}" is already taken`);
    const [w, d]: [number, number] = size ?? [16, 16];
    const [placement] = solvePlacements(
      world,
      // Regions don't block anything, so solve as a flat footprint.
      [{ id, size: [w, 0.01, shape === "rect" ? d : w], relations }],
      { pointer: ctx.pointer, camera: ctx.camera, seed: ctx.seed },
    );
    const region: Region = {
      id,
      shape,
      center: placement!.position,
      size: [w, 0, shape === "circle" ? w : d],
    };
    ctx.edit(`Create region ${id}`, (draft) => {
      draft.regions[id] = region;
    });
    return {
      ok: true,
      activity: `Marked out ${id.replace(/_/g, " ")}`,
      result: `Region ${id} ${shape} at ${fmt(region.center)} size ${region.size[0]}x${region.size[2]}m`,
    };
  },
});
