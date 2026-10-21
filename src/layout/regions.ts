import type { Rng } from "@/lib/random";
import type { Region } from "@/scene/schema";

/**
 * Region shapes on the ground plane. `size` is interpreted as:
 * - circle: size[0] = diameter
 * - rect:   size[0] = width (x), size[2] = depth (z)
 * - ring:   size[0] = outer diameter, size[2] = inner diameter
 */

export type Point2 = { x: number; z: number };

export function regionRadius(region: Region): number {
  if (region.shape === "rect") return Math.hypot(region.size[0], region.size[2]) / 2;
  return region.size[0] / 2;
}

/** Signed distance to the region's area: negative inside, positive outside. */
export function regionDistance(region: Region, p: Point2): number {
  const dx = p.x - region.center[0];
  const dz = p.z - region.center[2];
  switch (region.shape) {
    case "circle":
      return Math.hypot(dx, dz) - region.size[0] / 2;
    case "ring": {
      const r = Math.hypot(dx, dz);
      const outer = region.size[0] / 2;
      const inner = region.size[2] / 2;
      return Math.max(r - outer, inner - r);
    }
    case "rect": {
      const qx = Math.abs(dx) - region.size[0] / 2;
      const qz = Math.abs(dz) - region.size[2] / 2;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
      return outside + Math.min(Math.max(qx, qz), 0);
    }
  }
}

export function regionContains(region: Region, p: Point2, margin = 0): boolean {
  return regionDistance(region, p) <= -margin;
}

/** Point on the region's (outer) border at fraction t of the way round. */
export function regionEdgePoint(region: Region, t: number): Point2 {
  const [cx, , cz] = region.center;
  if (region.shape !== "rect") {
    const angle = t * Math.PI * 2;
    const r = region.size[0] / 2;
    return { x: cx + Math.cos(angle) * r, z: cz + Math.sin(angle) * r };
  }
  const w = region.size[0];
  const d = region.size[2];
  let s = (((t % 1) + 1) % 1) * 2 * (w + d);
  if (s < w) return { x: cx - w / 2 + s, z: cz - d / 2 };
  s -= w;
  if (s < d) return { x: cx + w / 2, z: cz - d / 2 + s };
  s -= d;
  if (s < w) return { x: cx + w / 2 - s, z: cz + d / 2 };
  s -= w;
  return { x: cx - w / 2, z: cz + d / 2 - s };
}

export function regionRandomPoint(region: Region, rng: Rng, margin = 0): Point2 {
  const [cx, , cz] = region.center;
  if (region.shape === "rect") {
    const hw = Math.max(0, region.size[0] / 2 - margin);
    const hd = Math.max(0, region.size[2] / 2 - margin);
    return { x: cx + (rng() * 2 - 1) * hw, z: cz + (rng() * 2 - 1) * hd };
  }
  const outer = Math.max(0, region.size[0] / 2 - margin);
  const inner = region.shape === "ring" ? Math.min(outer, region.size[2] / 2 + margin) : 0;
  // Uniform over the annulus area.
  const r = Math.sqrt(inner * inner + rng() * (outer * outer - inner * inner));
  const angle = rng() * Math.PI * 2;
  return { x: cx + Math.cos(angle) * r, z: cz + Math.sin(angle) * r };
}
