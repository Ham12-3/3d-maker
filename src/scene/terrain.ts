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

/** Water surface height at (x, z), or null when not over a lake. */
export function waterLevelAt(world: World, x: number, z: number): number | null {
  for (const lake of lakesOf(world)) {
    if (Math.hypot(x - lake.x, z - lake.z) < lake.radius) {
      return lakeWaterLevel(world.environment.terrain, lake);
    }
  }
  return null;
}

const worldCache = new Map<string, HeightField>();

/**
 * The world's real ground: base terrain with lakes carved in. Use this (not
 * getHeightField) anywhere objects meet the ground.
 */
export function getWorldHeightField(world: World): HeightField {
  const t = world.environment.terrain;
  const lakes = lakesOf(world);
  if (lakes.length === 0) return getHeightField(t);
  const key = `${t.type}:${t.seed}:${t.height}|${lakes.map((l) => `${l.x},${l.z},${l.radius}`).join(";")}`;
  let field = worldCache.get(key);
  if (!field) {
    field = carveLakes(getHeightField(t), lakes);
    if (worldCache.size > 16) worldCache.clear();
    worldCache.set(key, field);
  }
  return field;
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
