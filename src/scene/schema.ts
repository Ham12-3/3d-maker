import { z } from "zod";

/**
 * World schema: the single source of truth for scene data.
 * TypeScript types are inferred from these schemas (see bottom of file).
 *
 * Conventions (also in CLAUDE.md):
 * - Units are metres, Y is up.
 * - `transform.position` is absolute world space and marks the node's
 *   bottom-centre, so a node standing on the ground has y = heightAt(x, z).
 * - `transform.scale` of a primitive is its size in metres (unit geometry).
 */

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected a #rrggbb colour");

export const AssetRefSchema = z
  .object({
    source: z.enum(["polypizza", "kenney", "generated", "local"]),
    id: z.string().min(1),
    url: z.string().min(1),
    license: z.enum(["CC0", "CC-BY", "other"]),
    attribution: z.string().optional(),
  })
  .refine((a) => a.license !== "CC-BY" || Boolean(a.attribution), {
    message: "CC-BY assets need an attribution",
    path: ["attribution"],
  });

export const RelationSchema = z.object({
  predicate: z.enum([
    "on_top_of",
    "next_to",
    "near",
    "far_from",
    "in_front_of",
    "behind",
    "left_of",
    "right_of",
    "facing",
    "around",
    "along_edge_of",
    "inside_region",
  ]),
  /** Node id, region id, "camera", "pointer" or "origin". */
  target: z.string().min(1),
  distance: z.number().positive().optional(),
});

export const PrimitiveShapeSchema = z.enum(["box", "sphere", "cylinder", "cone", "plane", "torus"]);

export const ProceduralSchema = z.object({
  type: z.enum([
    "forest",
    "rocks",
    "grass",
    "flowers",
    "lake",
    "river",
    "path",
    "fireflies",
    "rain",
    "snow",
  ]),
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  seed: z.number().int(),
});

export const TransformSchema = z.object({
  position: Vec3Schema,
  rotation: Vec3Schema,
  scale: Vec3Schema,
});

export const MaterialSchema = z.object({
  color: HexColorSchema.optional(),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  emissive: HexColorSchema.optional(),
  emissiveIntensity: z.number().min(0).optional(),
  opacity: z.number().min(0).max(1).optional(),
});

const Vec2Schema = z.tuple([z.number(), z.number()]);

export const PartShapeSchema = z.enum([
  "box",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "capsule",
  "lathe",
  "extrude",
  "tube",
]);

/**
 * One piece of a custom object ("a windmill" = a cylinder tower, a cone roof
 * and four box sails). Units are metres, relative to the object's ground
 * centre; the renderer builds each part from a three.js geometry.
 */
export const PartSchema = z
  .object({
    shape: PartShapeSchema,
    position: Vec3Schema.optional().describe(
      "Centre of the part [x, y, z] in metres from the object's ground centre (y up, +z front). " +
        "Lathe/extrude/tube: where their own [0,0] point sits.",
    ),
    rotation: Vec3Schema.optional().describe("Degrees about x, y, z"),
    size: Vec3Schema.optional().describe(
      "[width, height, depth] in metres (default 1,1,1). Round shapes: width/depth are diameters. " +
        "Torus lies flat: [outer diameter, ring thickness, outer diameter]. Extrude: depth = thickness. " +
        "Tube: width = tube diameter. Lathe ignores size.",
    ),
    segments: z
      .number()
      .int()
      .min(3)
      .max(64)
      .optional()
      .describe("Sides of round shapes: 4 = square pyramid/prism, 6 = hexagonal. Default ~16"),
    taper: z
      .number()
      .min(0)
      .max(4)
      .optional()
      .describe("Cylinder only: top width / bottom width (0 = point, 0.5 = tapered tower)"),
    profile: z
      .array(Vec2Schema)
      .min(2)
      .max(40)
      .optional()
      .describe(
        "Lathe: [radius, height] points from bottom to top, spun around the y axis (vases, towers, bottles)",
      ),
    outline: z
      .array(Vec2Schema)
      .min(3)
      .max(40)
      .optional()
      .describe(
        "Extrude: [x, y] points of a flat shape in the x-y plane, given thickness along z (arches, signs, stars, gables)",
      ),
    path: z
      .array(Vec3Schema)
      .min(2)
      .max(24)
      .optional()
      .describe("Tube: [x, y, z] points the tube follows (pipes, rails, handles, curved arms)"),
    color: HexColorSchema.optional(),
    roughness: z.number().min(0).max(1).optional(),
    metalness: z.number().min(0).max(1).optional(),
    emissive: z
      .boolean()
      .optional()
      .describe("Glows in its own colour (lamps, windows, flames, screens)"),
    opacity: z.number().min(0.05).max(1).optional(),
  })
  .superRefine((part, ctx) => {
    const needs = { lathe: "profile", extrude: "outline", tube: "path" } as const;
    const key = needs[part.shape as keyof typeof needs];
    if (key && !part[key]) {
      ctx.addIssue({ code: "custom", message: `${part.shape} parts need \`${key}\``, path: [key] });
    }
  });

export const NodeIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "ids are lower_snake_case, e.g. cabin_1");

export const SceneNodeSchema = z
  .object({
    id: NodeIdSchema,
    name: z.string().min(1),
    kind: z.enum(["primitive", "asset", "procedural", "light", "group", "particles"]),
    primitive: PrimitiveShapeSchema.optional(),
    asset: AssetRefSchema.optional(),
    procedural: ProceduralSchema.optional(),
    /** kind "group": a custom object built from shapes. */
    parts: z.array(PartSchema).min(1).max(40).optional(),
    transform: TransformSchema,
    material: MaterialSchema.optional(),
    relations: z.array(RelationSchema),
    tags: z.array(z.string()),
    parentId: z.string().optional(),
    bounds: Vec3Schema.optional(),
    createdBy: z.enum(["agent", "user"]),
  })
  .refine((n) => n.kind !== "primitive" || n.primitive !== undefined, {
    message: "primitive nodes need a `primitive` shape",
    path: ["primitive"],
  })
  .refine((n) => n.kind !== "asset" || n.asset !== undefined, {
    message: "asset nodes need an `asset` ref",
    path: ["asset"],
  })
  .refine((n) => n.kind !== "procedural" || n.procedural !== undefined, {
    message: "procedural nodes need a `procedural` spec",
    path: ["procedural"],
  })
  .refine((n) => n.kind !== "group" || n.parts !== undefined, {
    message: "group nodes need `parts`",
    path: ["parts"],
  });

export const RegionSchema = z.object({
  id: NodeIdSchema,
  shape: z.enum(["circle", "rect", "ring"]),
  center: Vec3Schema,
  size: Vec3Schema,
});

export const SkySchema = z.enum(["clear", "overcast", "sunset", "night", "storm", "dreamy"]);
export const TerrainTypeSchema = z.enum(["flat", "hills", "island", "valley"]);

export const EnvironmentSchema = z.object({
  /** 0 to 24. Drives sun position, sky and light colour. */
  timeOfDay: z.number().min(0).max(24),
  sky: SkySchema,
  fog: z.object({
    enabled: z.boolean(),
    color: HexColorSchema,
    density: z.number().min(0).max(0.2),
  }),
  sun: z.object({ intensity: z.number().min(0), color: HexColorSchema }),
  ambient: z.object({ intensity: z.number().min(0), color: HexColorSchema }),
  stars: z.boolean(),
  weather: z.enum(["none", "rain", "snow"]),
  terrain: z.object({
    type: TerrainTypeSchema,
    seed: z.number().int(),
    height: z.number().min(0).max(60),
    color: HexColorSchema,
  }),
  postfx: z.object({
    bloom: z.number().min(0),
    vignette: z.number().min(0),
    saturation: z.number(),
  }),
  ambience: z.enum(["forest", "ocean", "wind", "night", "rain", "none"]).optional(),
});

export const CameraStateSchema = z.object({
  position: Vec3Schema,
  target: Vec3Schema,
  fov: z.number().min(10).max(120),
});

/** A reusable recipe of tool calls (Section 7.6). Steps use relations, never coordinates. */
export const MacroSchema = z.object({
  id: NodeIdSchema,
  name: z.string().min(1),
  description: z.string(),
  steps: z.array(z.object({ tool: z.string().min(1), input: z.unknown() })),
  builtIn: z.boolean(),
});

export const WorldSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    title: z.string(),
    nodes: z.record(z.string(), SceneNodeSchema),
    regions: z.record(z.string(), RegionSchema),
    environment: EnvironmentSchema,
    camera: CameraStateSchema,
    macros: z.record(z.string(), MacroSchema),
  })
  .superRefine((world, ctx) => {
    for (const [key, node] of Object.entries(world.nodes)) {
      if (key !== node.id) {
        ctx.addIssue({
          code: "custom",
          message: `node key "${key}" does not match its id "${node.id}"`,
          path: ["nodes", key, "id"],
        });
      }
      if (node.parentId !== undefined && !(node.parentId in world.nodes)) {
        ctx.addIssue({
          code: "custom",
          message: `parent "${node.parentId}" does not exist`,
          path: ["nodes", key, "parentId"],
        });
      }
    }
    for (const [key, region] of Object.entries(world.regions)) {
      if (key !== region.id) {
        ctx.addIssue({
          code: "custom",
          message: `region key "${key}" does not match its id "${region.id}"`,
          path: ["regions", key, "id"],
        });
      }
    }
  });

export type Vec3 = z.infer<typeof Vec3Schema>;
export type AssetRef = z.infer<typeof AssetRefSchema>;
export type Relation = z.infer<typeof RelationSchema>;
export type PrimitiveShape = z.infer<typeof PrimitiveShapeSchema>;
export type Part = z.infer<typeof PartSchema>;
export type SceneNode = z.infer<typeof SceneNodeSchema>;
export type Region = z.infer<typeof RegionSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
export type TerrainType = z.infer<typeof TerrainTypeSchema>;
export type CameraState = z.infer<typeof CameraStateSchema>;
export type Macro = z.infer<typeof MacroSchema>;
export type World = z.infer<typeof WorldSchema>;
