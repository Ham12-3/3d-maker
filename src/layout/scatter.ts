import { getKitModel } from "@/assets/catalog";
import { createRng } from "@/lib/random";
import type { SceneNode, Vec3, World } from "@/scene/schema";
import { WORLD_HALF_EXTENT, getWorldHeightField, nearestWater, waterBodies } from "@/scene/terrain";
import { distanceToPolyline, pathPolyline, pathWidth } from "./paths";
import type { Point2 } from "./regions";

/**
 * Scatter for instanced nature (forest, rocks, grass, flowers). Pure and
 * seeded: the renderer, the solver and the judge all get the same trees.
 * Instances keep clear of lakes, paths and real objects, so dropping a cabin
 * into a forest clears a spot for it.
 */

export type ScatterType = "forest" | "rocks" | "grass" | "flowers";

export type ScatterInstance = {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  /** Multiplier on the model's real-world size. */
  scale: number;
  /** Index into the feature's variant list. */
  variant: number;
};

type ScatterSpec = {
  variants: string[];
  weights?: number[];
  spacing: number;
  maxCount: number;
  defaultCount: number;
};

export const SPECIES: Record<string, string[]> = {
  pine: ["pine_tall_a", "pine_tall_b", "pine_a", "pine_round", "pine_small"],
  mixed: ["pine_tall_a", "pine_a", "tree_leafy", "oak", "tree_round"],
  deciduous: ["oak", "tree_leafy", "tree_round", "tree_bushy"],
  autumn: ["tree_autumn", "oak_autumn", "tree_leafy"],
  palm: ["palm_tall", "palm_bend"],
  dead: ["tree_dark"],
  snowy: ["pine_snowy"],
};

const SPECS: Record<ScatterType, ScatterSpec> = {
  forest: { variants: SPECIES.pine!, spacing: 3.6, maxCount: 300, defaultCount: 40 },
  rocks: {
    variants: [
      "rock_large_a",
      "rock_large_c",
      "rock_tall",
      "rock_small_a",
      "rock_small_c",
      "rock_flat",
    ],
    weights: [2, 2, 1, 4, 4, 3],
    spacing: 1.6,
    maxCount: 120,
    defaultCount: 18,
  },
  grass: { variants: ["grass_tuft"], spacing: 0.55, maxCount: 1500, defaultCount: 400 },
  flowers: {
    variants: ["flower_red", "flower_yellow", "flower_purple"],
    spacing: 0.7,
    maxCount: 500,
    defaultCount: 120,
  },
};

export function isScatterType(type: string | undefined): type is ScatterType {
  return type === "forest" || type === "rocks" || type === "grass" || type === "flowers";
}

/** Model ids this feature draws from (forest species, flower colour). */
export function scatterVariants(node: SceneNode): string[] {
  const type = node.procedural?.type;
  if (!isScatterType(type)) return [];
  const params = node.procedural!.params;
  if (type === "forest") return SPECIES[String(params.species ?? "pine")] ?? SPECIES.pine!;
  if (type === "flowers" && typeof params.colour === "string") {
    const match = SPECS.flowers.variants.filter((v) => v.includes(String(params.colour)));
    if (match.length) return match;
  }
  return SPECS[type].variants;
}

export function scatterCount(node: SceneNode): number {
  const type = node.procedural?.type;
  if (!isScatterType(type)) return 0;
  const spec = SPECS[type];
  return Math.min(
    spec.maxCount,
    Math.max(1, Math.round(Number(node.procedural!.params.count ?? spec.defaultCount))),
  );
}

/** Outer/inner radius of a scatter node's area (a disc, or a ring when inner > 0). */
export function scatterArea(node: SceneNode): { outer: number; inner: number } {
  const params = node.procedural?.params ?? {};
  return {
    outer: Number(params.radius ?? node.transform.scale[0] / 2),
    inner: Number(params.innerRadius ?? 0),
  };
}

export function scatterFeature(world: World, node: SceneNode): ScatterInstance[] {
  const type = node.procedural?.type;
  if (!isScatterType(type)) return [];
  const spec = SPECS[type];
  const variants = scatterVariants(node);
  const count = scatterCount(node);
  const { outer, inner } = scatterArea(node);
  const rng = createRng(node.procedural!.seed);
  const heightAt = getWorldHeightField(world);
  const [cx, , cz] = node.transform.position;

  const blockers = obstaclesFor(world, node);
  const spacing = Number(node.procedural!.params.spacing ?? spec.spacing);
  const grid = new Map<string, Point2[]>();
  const cell = spacing;
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const tooClose = (p: Point2) => {
    const gx = Math.floor(p.x / cell);
    const gz = Math.floor(p.z / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const q of grid.get(`${gx + i},${gz + j}`) ?? [])
          if (Math.hypot(p.x - q.x, p.z - q.z) < spacing) return true;
    return false;
  };

  const cumulative: number[] = [];
  const weights = spec.weights && variants === spec.variants ? spec.weights : variants.map(() => 1);
  weights.reduce((sum, w, i) => (cumulative[i] = sum + w), 0);
  const pickVariant = () => {
    const r = rng() * cumulative.at(-1)!;
    return cumulative.findIndex((c) => r < c);
  };

  const out: ScatterInstance[] = [];
  const attempts = count * 25;
  for (let a = 0; a < attempts && out.length < count; a++) {
    // Uniform over the disc/ring area.
    const r = Math.sqrt(inner * inner + rng() * (outer * outer - inner * inner));
    const angle = rng() * Math.PI * 2;
    const p = { x: cx + Math.cos(angle) * r, z: cz + Math.sin(angle) * r };
    const variant = pickVariant();
    const rotationY = rng() * Math.PI * 2;
    const scale = 0.75 + rng() * 0.5;
    if (Math.abs(p.x) > WORLD_HALF_EXTENT - 2 || Math.abs(p.z) > WORLD_HALF_EXTENT - 2) continue;
    if (tooClose(p) || blockers(p)) continue;
    const k = key(p.x, p.z);
    grid.set(k, [...(grid.get(k) ?? []), p]);
    out.push({ x: p.x, y: heightAt(p.x, p.z), z: p.z, rotationY, scale, variant });
  }
  return out;
}

/**
 * Cheap string that changes whenever anything scatter depends on changes
 * (terrain, lakes, paths, real objects). Renderers memo scatter on it.
 */
export function scatterKey(world: World): string {
  const t = world.environment.terrain;
  const parts = [`${t.type}:${t.seed}:${t.height}`];
  for (const n of Object.values(world.nodes)) {
    if (n.kind === "primitive" || n.kind === "asset" || n.procedural?.type === "lake") {
      const [x, , z] = n.transform.position;
      parts.push(`${n.id}@${x.toFixed(1)},${z.toFixed(1)},${n.transform.scale[0].toFixed(1)}`);
    } else if (n.procedural?.type === "path" || n.procedural?.type === "river") {
      const [x, , z] = n.transform.position;
      parts.push(
        `${n.id}:${String(n.procedural.params.from)}>${String(n.procedural.params.to)}@${x.toFixed(1)},${z.toFixed(1)},${n.transform.rotation[1].toFixed(2)},${String(n.procedural.params.width)}`,
      );
    }
  }
  return parts.join("|");
}

/** Real-world size of one instance, from the kit manifest. */
export function instanceSize(variantId: string, scale: number): Vec3 {
  const [w = 1, h = 1, d = 1] = getKitModel(variantId)?.size ?? [];
  return [w * scale, h * scale, d * scale];
}

/** Is p blocked for this feature: in a lake, on a path, or under a real object? */
function obstaclesFor(world: World, self: SceneNode): (p: Point2) => boolean {
  const water = waterBodies(world);
  const paths = Object.values(world.nodes)
    .filter((n) => n.procedural?.type === "path")
    .map((n) => ({ points: pathPolyline(world, n), clear: pathWidth(n) / 2 + 0.6 }));
  const solids = Object.values(world.nodes)
    .filter((n) => n.kind === "primitive" || n.kind === "asset")
    .map((n) => ({
      x: n.transform.position[0],
      z: n.transform.position[2],
      r: Math.max(n.transform.scale[0], n.transform.scale[2]) / 2 + 1,
    }));
  const isGrassy = self.procedural?.type === "grass" || self.procedural?.type === "flowers";

  return (p) => {
    const hit = nearestWater(water, p.x, p.z);
    if (hit && hit.distance < (isGrassy ? 0.4 : 1.6)) return true;
    for (const path of paths) if (distanceToPolyline(path.points, p) < path.clear) return true;
    for (const s of solids) if (Math.hypot(p.x - s.x, p.z - s.z) < s.r) return true;
    return false;
  };
}
