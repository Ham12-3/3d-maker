import { nearestOnPolyline, pathPolyline, pathWidth } from "@/layout/paths";
import type { Point2 } from "@/layout/regions";
import { createNoise2D, fbm, smoothstep } from "@/lib/noise";
import type { Environment, World } from "./schema";

/**
 * Terrain height field shared by the renderer and the layout solver.
 * Pure: the same params always give the same heights.
 *
 * Every terrain type keeps a flat build area (radius FLAT_RADIUS) at y = 0
 * around the origin, so hand-placed and solved objects there sit at y = 0.
 */

export const TERRAIN_SIZE = 240;
export const WORLD_HALF_EXTENT = TERRAIN_SIZE / 2;
export const FLAT_RADIUS = 16;
const BLEND = 24;

export type TerrainParams = Pick<Environment["terrain"], "type" | "seed" | "height">;
export type HeightField = (x: number, z: number) => number;

const cache = new Map<string, HeightField>();

export function getHeightField(params: TerrainParams): HeightField {
  const key = `${params.type}:${params.seed}:${params.height}`;
  let field = cache.get(key);
  if (!field) {
    field = createHeightField(params);
    if (cache.size > 16) cache.clear();
    cache.set(key, field);
  }
  return field;
}

/** A lake carves a bowl into the terrain; its water sits just below the rim. */
export type Lake = { x: number; z: number; radius: number };

const LAKE_DEPTH = 1.6;
const RIM_DROP = 0.15;
const WATER_DROP = 0.35;
/** The shore blends back to the natural terrain out to this multiple of the radius. */
export const SHORE_FACTOR = 1.35;

export function lakesOf(world: World): Lake[] {
  const lakes: Lake[] = [];
  for (const node of Object.values(world.nodes)) {
    if (node.kind !== "procedural" || node.procedural?.type !== "lake") continue;
    const radius = Number(node.procedural.params.radius ?? node.transform.scale[0] / 2);
    lakes.push({ x: node.transform.position[0], z: node.transform.position[2], radius });
  }
  return lakes;
}

/** Water surface height of a lake, from the uncarved terrain at its centre. */
export function lakeWaterLevel(terrain: TerrainParams, lake: Lake): number {
  return getHeightField(terrain)(lake.x, lake.z) - WATER_DROP;
}

/** A river is a carved channel along a polyline, with water just below the banks. */
export type River = {
  id: string;
  points: Point2[];
  half: number;
  /** Water surface height at each point (the base terrain there, minus a drop). */
  levels: number[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};

const RIVER_DEPTH = 1.2;
const RIVER_BANK = 3;

export function riversOf(world: World): River[] {
  const base = getHeightField(world.environment.terrain);
  const rivers: River[] = [];
  for (const node of Object.values(world.nodes)) {
    if (node.procedural?.type !== "river") continue;
    const points = pathPolyline(world, node);
    const half = pathWidth(node) / 2;
    const pad = half + RIVER_BANK;
    rivers.push({
      id: node.id,
      points,
      half,
      levels: points.map((p) => base(p.x, p.z) - WATER_DROP),
      bounds: {
        minX: Math.min(...points.map((p) => p.x)) - pad,
        maxX: Math.max(...points.map((p) => p.x)) + pad,
        minZ: Math.min(...points.map((p) => p.z)) - pad,
        maxZ: Math.max(...points.map((p) => p.z)) + pad,
      },
    });
  }
  return rivers;
}

export type WaterBodies = { lakes: Lake[]; rivers: River[]; terrain: TerrainParams };

export function waterBodies(world: World): WaterBodies {
  return { lakes: lakesOf(world), rivers: riversOf(world), terrain: world.environment.terrain };
}

/**
 * Nearest water to (x, z): signed distance to its edge (negative inside),
 * the water level there, and the unit direction pointing out of the water.
 */
export type WaterHit = { distance: number; level: number; away: Point2 };

export function nearestWater(bodies: WaterBodies, x: number, z: number): WaterHit | null {
  let best: WaterHit | null = null;
  for (const lake of bodies.lakes) {
    const d = Math.hypot(x - lake.x, z - lake.z);
    const distance = d - lake.radius;
    if (!best || distance < best.distance) {
      best = {
        distance,
        level: lakeWaterLevel(bodies.terrain, lake),
        away: d > 1e-6 ? { x: (x - lake.x) / d, z: (z - lake.z) / d } : { x: 1, z: 0 },
      };
    }
  }
  for (const river of bodies.rivers) {
    const n = nearestOnPolyline(river.points, { x, z });
    const distance = n.distance - river.half;
    if (best && distance >= best.distance) continue;
    const a = river.points[n.index]!;
    const b = river.points[n.index + 1] ?? a;
    const level =
      river.levels[n.index]! +
      ((river.levels[n.index + 1] ?? river.levels[n.index]!) - river.levels[n.index]!) * n.t;
    // Out of the channel: away from the centreline (or sideways if on it).
    const away =
      n.distance > 1e-6
        ? { x: (x - n.point.x) / n.distance, z: (z - n.point.z) / n.distance }
        : normalise({ x: -(b.z - a.z), z: b.x - a.x });
    best = { distance, level, away };
  }
  return best;
}

/** Water surface height at (x, z), or null when not over a lake or river. */
export function waterLevelAt(world: World, x: number, z: number): number | null {
  const hit = nearestWater(waterBodies(world), x, z);
  return hit && hit.distance < 0 ? hit.level : null;
}

/** Changes exactly when any water (or what a river is attached to) changes. */
export function waterKey(world: World): string {
  const parts: string[] = [];
  for (const n of Object.values(world.nodes)) {
    const type = n.procedural?.type;
    if (type !== "lake" && type !== "river") continue;
    parts.push(
      `${n.id}:${JSON.stringify(n.procedural!.params)}@${n.transform.position.join(",")}/${n.transform.rotation[1]}`,
    );
    if (type === "river") {
      for (const ref of [n.procedural!.params.from, n.procedural!.params.to]) {
        const end = typeof ref === "string" ? world.nodes[ref] : undefined;
        if (end) parts.push(end.transform.position.join(","));
      }
    }
  }
  return parts.join("|");
}

const worldCache = new Map<string, HeightField>();

/**
 * The world's real ground: base terrain with lakes and rivers carved in. Use
 * this (not getHeightField) anywhere objects meet the ground.
 */
export function getWorldHeightField(world: World): HeightField {
  const t = world.environment.terrain;
  const lakes = lakesOf(world);
  const riverNodes = Object.values(world.nodes).filter((n) => n.procedural?.type === "river");
  if (lakes.length === 0 && riverNodes.length === 0) return getHeightField(t);
  const riverKey = riverNodes
    .map(
      (n) =>
        `${n.id}:${JSON.stringify(n.procedural!.params)}@${n.transform.position.join(",")}/${n.transform.rotation[1]}`,
    )
    .join(";");
  const endpointsKey = riverNodes
    .flatMap((n) => [n.procedural!.params.from, n.procedural!.params.to])
    .map((ref) =>
      typeof ref === "string" && world.nodes[ref]
        ? world.nodes[ref]!.transform.position.join(",")
        : String(ref),
    )
    .join(";");
  const key = `${t.type}:${t.seed}:${t.height}|${lakes.map((l) => `${l.x},${l.z},${l.radius}`).join(";")}|${riverKey}|${endpointsKey}`;
  let field = worldCache.get(key);
  if (!field) {
    field = carveRivers(carveLakes(getHeightField(t), lakes), riversOf(world));
    if (worldCache.size > 16) worldCache.clear();
    worldCache.set(key, field);
  }
  return field;
}

export function carveRivers(base: HeightField, rivers: River[]): HeightField {
  if (rivers.length === 0) return base;
  return (x, z) => {
    let h = base(x, z);
    for (const r of rivers) {
      const b = r.bounds;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      const n = nearestOnPolyline(r.points, { x, z });
      if (n.distance >= r.half + RIVER_BANK) continue;
      const level =
        r.levels[n.index]! +
        ((r.levels[n.index + 1] ?? r.levels[n.index]!) - r.levels[n.index]!) * n.t;
      const rim = level + WATER_DROP - RIM_DROP;
      const s = n.distance / r.half;
      const carved =
        s < 1
          ? rim - RIVER_DEPTH * (1 - s * s)
          : rim + (h - rim) * smoothstep(r.half, r.half + RIVER_BANK, n.distance);
      h = Math.min(h, carved);
    }
    return h;
  };
}

function normalise(v: Point2): Point2 {
  const len = Math.hypot(v.x, v.z) || 1;
  return { x: v.x / len, z: v.z / len };
}

export function carveLakes(base: HeightField, lakes: Lake[]): HeightField {
  const rims = lakes.map((l) => base(l.x, l.z) - RIM_DROP);
  return (x, z) => {
    let h = base(x, z);
    lakes.forEach((lake, i) => {
      const t = Math.hypot(x - lake.x, z - lake.z) / lake.radius;
      if (t >= SHORE_FACTOR) return;
      const rim = rims[i]!;
      const carved =
        t < 1 ? rim - LAKE_DEPTH * (1 - t * t) : rim + (h - rim) * smoothstep(1, SHORE_FACTOR, t);
      h = Math.min(h, carved);
    });
    return h;
  };
}

export function createHeightField({ type, seed, height }: TerrainParams): HeightField {
  if (type === "flat" || height === 0) return () => 0;
  const noise = createNoise2D(seed);
  const outside = (r: number) => smoothstep(FLAT_RADIUS, FLAT_RADIUS + BLEND, r);

  switch (type) {
    case "hills":
      return (x, z) => {
        const n = fbm(noise, x / 55, z / 55) * 0.5 + 0.5;
        return n * height * outside(Math.hypot(x, z));
      };
    case "island":
      return (x, z) => {
        const r = Math.hypot(x, z);
        const n = fbm(noise, x / 40, z / 40) * 0.5 + 0.5;
        const land = n * height * 0.6 * outside(r);
        const shore = smoothstep(55, 95, r + n * 15);
        return land * (1 - shore) - shore * height * 0.5;
      };
    case "valley":
      return (x, z) => {
        const n = fbm(noise, x / 45, z / 45) * 0.5 + 0.5;
        const walls = smoothstep(FLAT_RADIUS, 90, Math.abs(x));
        return height * walls * (0.6 + 0.4 * n) + n * height * 0.15 * outside(Math.hypot(x, z));
      };
  }
}
