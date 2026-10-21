import { z } from "zod";
import { regionRadius } from "@/layout/regions";
import { scatterFeature, SPECIES } from "@/layout/scatter";
import { nodeSize, solvePlacements } from "@/layout/solver";
import { nextNodeId } from "@/scene/ops";
import {
  NodeIdSchema,
  RelationSchema,
  type Relation,
  type SceneNode,
  type Vec3,
  type World,
} from "@/scene/schema";
import {
  getWorldHeightField,
  lakeWaterLevel,
  nearestWater,
  SHORE_FACTOR,
  waterBodies,
} from "@/scene/terrain";
import { defineTool, fail, fmt, type ToolContext } from "./types";

const TYPES = [
  "forest",
  "rocks",
  "grass",
  "flowers",
  "lake",
  "river",
  "path",
  "fireflies",
] as const;
type FeatureType = (typeof TYPES)[number];

const DEFAULTS: Record<FeatureType, { radius: number; height: number; count?: number }> = {
  forest: { radius: 20, height: 12, count: 40 },
  rocks: { radius: 8, height: 2, count: 18 },
  grass: { radius: 12, height: 0.5, count: 400 },
  flowers: { radius: 5, height: 0.4, count: 120 },
  lake: { radius: 12, height: 0.1 },
  river: { radius: 3, height: 0.1 },
  path: { radius: 1, height: 0.05 },
  fireflies: { radius: 12, height: 3, count: 120 },
};

const input = z.object({
  type: z.enum(TYPES),
  id: NodeIdSchema.optional().describe("Readable id, e.g. 'lake_1', 'pine_forest_1'"),
  name: z.string().max(60).optional(),
  radius: z
    .number()
    .min(1)
    .max(60)
    .optional()
    .describe(
      "Lake radius, or the width of the band/area to fill in metres. Defaults: lake 12, forest 20, rocks 8, grass 12",
    ),
  count: z
    .number()
    .int()
    .min(1)
    .max(1500)
    .optional()
    .describe("How many trees/rocks/tufts/fireflies"),
  species: z
    .enum(Object.keys(SPECIES) as [string, ...string[]])
    .optional()
    .describe("Forest tree type"),
  colour: z.enum(["red", "yellow", "purple"]).optional().describe("Flowers only"),
  water_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe("Lake only"),
  relations: z
    .array(RelationSchema)
    .max(3)
    .optional()
    .describe(
      "'around' a lake/object makes a ring just outside it; 'inside_region' fills a region or feature; " +
        "near/behind/left_of... place the area's centre.",
    ),
  region: z.string().optional().describe("Fill this region (same as an inside_region relation)"),
  from: z.string().optional().describe("Path/river start: node id, region id or 'pointer'"),
  to: z.string().optional().describe("Path/river end: node id, region id or 'pointer'"),
  width: z
    .number()
    .min(0.5)
    .max(20)
    .optional()
    .describe("Path width (default 1.6) or river width (default 6) in metres"),
});

export const addProceduralTool = defineTool({
  name: "add_procedural",
  pending: "Growing nature",
  eagerInputStreaming: true,
  description: [
    "Add a natural feature, efficiently instanced: forest, rocks, grass, flowers, lake, river, path or fireflies. Use this for anything with more than ~10 copies.",
    "Lakes and rivers carve the terrain and get sandy banks; forests and grass avoid water, paths and objects automatically.",
    "A river with no from/to flows straight across the view through its centre (relations place the centre); with from/to it runs between them (e.g. into a lake).",
    "Typical: lake first, then forest around it, then props on the shore.",
    'Examples: {"type":"lake","id":"lake_1","radius":12}; {"type":"forest","species":"pine","count":60,"radius":18,"relations":[{"predicate":"around","target":"lake_1"}]};',
    '{"type":"path","from":"cabin_1","to":"lake_1"}; {"type":"fireflies","relations":[{"predicate":"inside_region","target":"lake_1"}]}.',
  ].join(" "),
  input,
  execute(args, ctx) {
    const world = ctx.getWorld();
    const type = args.type;
    const id = nextNodeId(
      world,
      args.id ?? (type === "forest" && args.species ? `${args.species}_forest` : type),
    );
    const defaults = DEFAULTS[type];
    const seed = (ctx.seed ^ hash(id)) >>> 0;
    const params: Record<string, number | string | boolean> = {};
    let center: Vec3;
    let relations: Relation[] = args.relations ?? [];
    let areaNote = "";

    let rotationY = 0;
    if ((type === "path" || type === "river") && args.from && args.to) {
      const from = endpointRef(args.from, ctx);
      const to = endpointRef(args.to, ctx);
      const a = endpointPos(world, from);
      const b = endpointPos(world, to);
      if (!a || !b) return fail(`Unknown ${type} endpoint: ${!a ? args.from : args.to}`);
      Object.assign(params, { from, to, width: args.width ?? (type === "river" ? 6 : 1.6) });
      center = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
      relations = [];
      areaNote = `from ${from} to ${to}`;
    } else if (type === "path") {
      return fail("A path needs both from and to.");
    } else if (type === "river") {
      // Straight across the view (left to right), through a solved centre.
      const [placement] = solvePlacements(world, [{ id, size: [6, 0.1, 6], relations }], {
        pointer: ctx.pointer,
        camera: ctx.camera,
        seed: ctx.seed,
      });
      center = placement!.position;
      const fx = ctx.camera.target[0] - ctx.camera.position[0];
      const fz = ctx.camera.target[2] - ctx.camera.position[2];
      rotationY = Math.atan2(-fz, fx);
      Object.assign(params, { width: args.width ?? 6, length: 140 });
      areaNote = `across the view through ${fmt(center)}`;
    } else {
      const area = planFeatureArea(world, { ...args, type, relations }, id, ctx);
      if (typeof area === "string") return fail(area);
      center = area.center;
      relations = area.relations;
      areaNote = area.note;
      Object.assign(params, {
        radius: area.outer,
        ...(area.inner ? { innerRadius: area.inner } : {}),
      });
    }

    if (defaults.count !== undefined) params.count = args.count ?? defaults.count;
    if (type === "forest") params.species = args.species ?? "pine";
    if (type === "flowers" && args.colour) params.colour = args.colour;
    if (type === "lake" && args.water_color) params.color = args.water_color;

    const outer = Number(params.radius ?? 1);
    const y =
      type === "lake"
        ? lakeWaterLevel(world.environment.terrain, { x: center[0], z: center[2], radius: outer })
        : center[1];
    const node: SceneNode = {
      id,
      name: args.name ?? (type === "forest" ? `${params.species} forest` : type),
      kind: "procedural",
      procedural: { type, params, seed },
      transform: {
        position: [round(center[0]), round(y), round(center[2])],
        rotation: [0, round(rotationY), 0],
        scale:
          type === "path" || type === "river"
            ? [1, defaults.height, Number(params.width)]
            : [outer * 2, defaults.height, outer * 2],
      },
      relations,
      tags: [
        type,
        ...(type === "forest" ? ["tree", String(params.species)] : []),
        ...(type === "lake" || type === "river" ? ["water"] : []),
      ],
      createdBy: "agent",
    };

    let moved: string[] = [];
    ctx.edit(`Add ${type}`, (draft) => {
      draft.nodes[id] = node;
      if (type === "lake" || type === "river") moved = clearWaterArea(draft);
    });

    const after = ctx.getWorld();
    const instances =
      type === "forest" || type === "rocks" || type === "grass" || type === "flowers"
        ? scatterFeature(after, after.nodes[id]!).length
        : null;
    const lines = [
      `${id} ${type}${params.species ? ` (${params.species})` : ""} ${areaNote}` +
        (instances !== null ? `, ${instances} placed` : "") +
        (type === "lake" ? `, water level y=${y.toFixed(2)}` : ""),
    ];
    if (instances !== null && instances < Number(params.count) * 0.6) {
      lines.push(`Only ${instances} of ${params.count} fit; the area is crowded or small.`);
    }
    if (moved.length) lines.push(`Moved out of the water / re-grounded: ${moved.join(", ")}`);
    return { ok: true, activity: activityFor(type, instances), result: lines.join("\n") };
  },
});

export type FeatureArea = {
  center: Vec3;
  outer: number;
  inner?: number;
  relations: Relation[];
  note: string;
};

/**
 * Where an area feature goes: a ring just outside an "around" target, the
 * whole of an inside_region target, or a disc placed by the solver. Pure and
 * synchronous, so streaming previews can show the same area early.
 */
export function planFeatureArea(
  world: World,
  args: {
    type: Exclude<FeatureType, "path">;
    radius?: number;
    relations?: Relation[];
    region?: string;
  },
  id: string,
  ctx: Pick<ToolContext, "pointer" | "camera" | "seed">,
): FeatureArea | string {
  const defaults = DEFAULTS[args.type];
  const radius = args.radius ?? defaults.radius;
  const relations = args.relations ?? [];
  const around = relations.find((r) => r.predicate === "around");
  const insideTarget =
    args.region ?? relations.find((r) => r.predicate === "inside_region")?.target;

  if (around && args.type !== "lake") {
    const anchor = areaOf(world, around.target);
    if (!anchor) return `Unknown target "${around.target}"`;
    const inner = anchor.radius * (anchor.isLake ? SHORE_FACTOR : 1) + (around.distance ?? 2);
    return {
      center: [anchor.center[0], 0, anchor.center[2]],
      outer: inner + radius,
      inner,
      relations,
      note: `ring ${inner.toFixed(0)}-${(inner + radius).toFixed(0)}m around ${around.target}`,
    };
  }
  if (insideTarget && args.type !== "lake") {
    const anchor = areaOf(world, insideTarget);
    if (!anchor) return `Unknown region "${insideTarget}"`;
    return {
      center: [anchor.center[0], 0, anchor.center[2]],
      outer: Math.min(anchor.radius, args.radius ?? anchor.radius),
      relations: [{ predicate: "inside_region", target: insideTarget }],
      note: `inside ${insideTarget}`,
    };
  }
  const [placement] = solvePlacements(
    world,
    [{ id, size: [radius * 2, defaults.height, radius * 2], relations }],
    { pointer: ctx.pointer, camera: ctx.camera, seed: ctx.seed },
  );
  return {
    center: placement!.position,
    outer: radius,
    relations,
    note: `radius ${radius}m at ${fmt(placement!.position)}`,
  };
}

/**
 * After new water appears: push objects out of it and re-ground anything on
 * the new banks (the terrain under them just changed).
 */
function clearWaterArea(world: World): string[] {
  const heightAt = getWorldHeightField(world);
  const water = waterBodies(world);
  const touched: string[] = [];
  for (const n of Object.values(world.nodes)) {
    if (n.kind !== "primitive" && n.kind !== "asset") continue;
    if (n.relations.some((rel) => rel.predicate === "on_top_of")) continue;
    if (n.tags.some((t) => t === "boat" || t === "canoe" || t === "lily")) continue;
    const [x0, y, z0] = n.transform.position;
    const itemR = Math.max(nodeSize(n)[0], nodeSize(n)[2]) / 2;
    const hit = nearestWater(water, x0, z0);
    let x = x0;
    let z = z0;
    if (hit && hit.distance < itemR) {
      const push = itemR - hit.distance + 0.5;
      x += hit.away.x * push;
      z += hit.away.z * push;
    }
    const ground = heightAt(x, z);
    if (Math.abs(ground - y) > 0.01 || x !== x0 || z !== z0) {
      n.transform.position = [round(x), round(ground), round(z)];
      touched.push(n.id);
    }
  }
  return touched;
}

/** Centre and radius of something an area can be built around or inside. */
function areaOf(
  world: World,
  target: string,
): { center: Vec3; radius: number; isLake: boolean } | null {
  const node = world.nodes[target];
  if (node) {
    const isLake = node.procedural?.type === "lake";
    const radius =
      node.procedural?.params.radius !== undefined
        ? Number(node.procedural.params.radius)
        : Math.max(nodeSize(node)[0], nodeSize(node)[2]) / 2;
    return { center: node.transform.position, radius, isLake };
  }
  const region = world.regions[target];
  if (region) return { center: region.center, radius: regionRadius(region), isLake: false };
  return null;
}

function endpointRef(ref: string, ctx: ToolContext): string {
  if (ref === "pointer" || ref === "there") {
    const p = ctx.pointer ?? ctx.camera.target;
    return `${p[0].toFixed(1)},${p[2].toFixed(1)}`;
  }
  return ref;
}

function endpointPos(world: World, ref: string): Vec3 | null {
  const xy = ref.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (xy) return [Number(xy[1]), 0, Number(xy[2])];
  return world.nodes[ref]?.transform.position ?? world.regions[ref]?.center ?? null;
}

function activityFor(type: FeatureType, instances: number | null): string {
  switch (type) {
    case "forest":
      return `Planted ${instances} trees`;
    case "rocks":
      return `Scattered ${instances} rocks`;
    case "grass":
      return "Grew the grass";
    case "flowers":
      return "Planted flowers";
    case "lake":
      return "Filled the lake";
    case "river":
      return "Carved a river";
    case "path":
      return "Laid a path";
    case "fireflies":
      return "Released fireflies";
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
