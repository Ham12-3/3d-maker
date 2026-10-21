import { createNoise2D, fbm, smoothstep } from "@/lib/noise";
import type { Environment } from "./schema";

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
