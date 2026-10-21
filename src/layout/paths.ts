import { createNoise2D } from "@/lib/noise";
import type { SceneNode, World } from "@/scene/schema";
import type { Point2 } from "./regions";

/**
 * Paths are procedural nodes whose params name two endpoints (`from`, `to`:
 * node ids, region ids or "x,z"). The polyline is derived from the world, so
 * a path follows its endpoints when they move.
 */

export const DEFAULT_PATH_WIDTH = 1.6;

export function pathWidth(node: SceneNode): number {
  return Number(node.procedural?.params.width ?? DEFAULT_PATH_WIDTH);
}

export function pathPolyline(world: World, node: SceneNode): Point2[] {
  const params = node.procedural?.params ?? {};
  const a = endpoint(world, params.from, node);
  const b = endpoint(world, params.to, node);
  const [from, to] =
    a && b ? trimEnds(world, String(params.from), String(params.to), a, b) : fallbackLine(node);

  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(2, Math.ceil(length / 1));
  const noise = createNoise2D(node.procedural?.seed ?? 1);
  const nx = -(to.z - from.z) / (length || 1);
  const nz = (to.x - from.x) / (length || 1);
  const wander = Math.min(3, length * 0.12);

  const points: Point2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Gentle meander, pinned to zero at both ends.
    const offset = noise(t * 2.2, 0.5) * wander * Math.sin(Math.PI * t);
    points.push({
      x: from.x + (to.x - from.x) * t + nx * offset,
      z: from.z + (to.z - from.z) * t + nz * offset,
    });
  }
  return points;
}

/** Shortest distance from p to the polyline. */
export function distanceToPolyline(points: Point2[], p: Point2): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)));
  }
  return best;
}

/** Point and unit normal at fraction t (0..1) along the polyline by arc length. */
export function pointAlong(points: Point2[], t: number): { p: Point2; normal: Point2 } {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(
      lengths[i - 1]! +
        Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z),
    );
  }
  const target = Math.max(0, Math.min(1, t)) * lengths.at(-1)!;
  let i = 1;
  while (i < points.length - 1 && lengths[i]! < target) i++;
  const a = points[i - 1]!;
  const b = points[i]!;
  const seg = lengths[i]! - lengths[i - 1]! || 1;
  const k = (target - lengths[i - 1]!) / seg;
  const dx = (b.x - a.x) / seg;
  const dz = (b.z - a.z) / seg;
  return { p: { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }, normal: { x: -dz, z: dx } };
}

function endpoint(world: World, ref: unknown, self: SceneNode): Point2 | null {
  if (typeof ref !== "string" || ref === self.id) return null;
  const xy = ref.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (xy) return { x: Number(xy[1]), z: Number(xy[2]) };
  const node = world.nodes[ref];
  if (node) return { x: node.transform.position[0], z: node.transform.position[2] };
  const region = world.regions[ref];
  if (region) return { x: region.center[0], z: region.center[2] };
  return null;
}

/** Stop at the edge of an endpoint object instead of running through it. */
function trimEnds(
  world: World,
  fromRef: string,
  toRef: string,
  a: Point2,
  b: Point2,
): [Point2, Point2] {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const radius = (ref: string) => {
    const n = world.nodes[ref];
    if (!n) return 0;
    const r =
      n.procedural?.type === "lake"
        ? Number(n.procedural.params.radius ?? 0)
        : Math.max(n.transform.scale[0], n.transform.scale[2]) / 2;
    return Math.min(r + 0.3, len / 3);
  };
  const ra = radius(fromRef);
  const rb = radius(toRef);
  return [
    { x: a.x + ux * ra, z: a.z + uz * ra },
    { x: b.x - ux * rb, z: b.z - uz * rb },
  ];
}

function fallbackLine(node: SceneNode): [Point2, Point2] {
  const half = Number(node.procedural?.params.length ?? 20) / 2;
  const angle = node.transform.rotation[1];
  const [x, , z] = node.transform.position;
  const dx = Math.sin(angle) * half;
  const dz = Math.cos(angle) * half;
  return [
    { x: x - dx, z: z - dz },
    { x: x + dx, z: z + dz },
  ];
}
