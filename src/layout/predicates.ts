import type { Rng } from "@/lib/random";
import type { Region, Relation } from "@/scene/schema";
import { distanceToPolyline, pointAlong } from "./paths";
import {
  regionDistance,
  regionEdgePoint,
  regionRandomPoint,
  regionRadius,
  type Point2,
} from "./regions";

/**
 * Per-predicate candidate generation and scoring. The solver asks each
 * positional relation for candidate points, then scores every candidate
 * against all of the item's relations.
 */

export type Anchor = {
  /** Ground-level centre. */
  center: Point2;
  /** Footprint radius (0 for points like the pointer). */
  radius: number;
  /** Half extents of a node's footprint, for on_top_of. */
  halfX: number;
  halfZ: number;
  /** y of the anchor's top surface (ground height for points and regions). */
  top: number;
  region?: Region;
  nodeId?: string;
  /** Paths: the centreline. `radius` is then the half width. */
  polyline?: Point2[];
};

const POLYLINE_PREDICATES: ReadonlySet<Relation["predicate"]> = new Set([
  "near",
  "next_to",
  "along_edge_of",
  "around",
]);

/** Desired gap (beyond the path edge and the item's own radius) per predicate. */
function polylineGap(rel: Relation): number {
  if (rel.predicate === "near" || rel.predicate === "around") return (rel.distance ?? 2) * 0.6;
  return rel.distance ?? DEFAULT_NEXT_TO_GAP;
}

function polylineCandidates(
  rel: Relation,
  anchor: Anchor,
  item: ItemShape,
  rng: Rng,
  group: Group,
): Point2[] {
  const points = anchor.polyline!;
  const offset = anchor.radius + item.radius + polylineGap(rel);
  const out: Point2[] = [];
  const push = (t: number, side: number) => {
    const { p, normal } = pointAlong(points, t);
    out.push({ x: p.x + normal.x * offset * side, z: p.z + normal.z * offset * side });
  };
  if (group.size > 1) {
    // Evenly spaced along the path, alternating sides.
    const slot = (group.index + 0.5) / group.size;
    const side = group.index % 2 === 0 ? 1 : -1;
    for (let i = 0; i < 6; i++)
      push(slot + (rng() - 0.5) * (0.3 / group.size), i < 4 ? side : -side);
  } else {
    for (let i = 0; i < 12; i++) {
      push((i + 0.5) / 12, 1);
      push((i + 0.5) / 12, -1);
    }
  }
  return out;
}

function polylineScore(rel: Relation, anchor: Anchor, item: ItemShape, p: Point2): number {
  const gap = distanceToPolyline(anchor.polyline!, p) - anchor.radius - item.radius;
  if (gap < -0.05) return -1;
  const target = polylineGap(rel);
  if (rel.predicate === "near" || rel.predicate === "around")
    return gap <= target * 1.5 ? 1 : 1 - (gap - target) / (target + 1);
  return 1 - Math.abs(gap - target) / 2;
}

export type ItemShape = { radius: number; halfX: number; halfZ: number };

/** Camera axes on the ground plane, for left/right/in front/behind. */
export type ViewAxes = { forward: Point2; right: Point2 };

export type Group = { index: number; size: number };

export const POSITIONAL: ReadonlySet<Relation["predicate"]> = new Set([
  "on_top_of",
  "next_to",
  "near",
  "far_from",
  "in_front_of",
  "behind",
  "left_of",
  "right_of",
  "around",
  "along_edge_of",
  "inside_region",
]);

const DEFAULT_NEAR = 4;
const DEFAULT_NEXT_TO_GAP = 0.3;
const DEFAULT_FAR = 25;

export function candidates(
  rel: Relation,
  anchor: Anchor,
  item: ItemShape,
  axes: ViewAxes,
  rng: Rng,
  group: Group,
): Point2[] {
  if (anchor.polyline && POLYLINE_PREDICATES.has(rel.predicate)) {
    return polylineCandidates(rel, anchor, item, rng, group);
  }
  const out: Point2[] = [];
  const ring = (radius: number, count: number, phase = rng() * Math.PI * 2) => {
    for (let i = 0; i < count; i++) {
      const angle = phase + (i / count) * Math.PI * 2;
      out.push({
        x: anchor.center.x + Math.cos(angle) * radius,
        z: anchor.center.z + Math.sin(angle) * radius,
      });
    }
  };
  const gap = anchor.radius + item.radius;

  switch (rel.predicate) {
    case "near":
      for (const f of [0.35, 0.65, 1]) ring(gap + (rel.distance ?? DEFAULT_NEAR) * f, 12);
      break;
    case "next_to":
      ring(gap + (rel.distance ?? DEFAULT_NEXT_TO_GAP), 16);
      ring(gap + (rel.distance ?? DEFAULT_NEXT_TO_GAP) + 0.6, 16);
      break;
    case "far_from": {
      const d = Math.max(gap + (rel.distance ?? DEFAULT_FAR), 8);
      ring(d, 16);
      ring(d * 1.25, 16);
      break;
    }
    case "in_front_of":
    case "behind":
    case "left_of":
    case "right_of": {
      const dir = direction(rel.predicate, axes);
      const lateral = { x: -dir.z, z: dir.x };
      const base = gap + (rel.distance ?? 1);
      for (const along of [base, base + 1, base + 2.5]) {
        for (const side of [0, -1, 1, -2, 2]) {
          out.push({
            x: anchor.center.x + dir.x * along + lateral.x * side * item.radius,
            z: anchor.center.z + dir.z * along + lateral.z * side * item.radius,
          });
        }
      }
      break;
    }
    case "on_top_of": {
      const spreadX = Math.max(0, anchor.halfX - item.halfX);
      const spreadZ = Math.max(0, anchor.halfZ - item.halfZ);
      out.push({ ...anchor.center });
      for (let i = 0; i < 12; i++) {
        out.push({
          x: anchor.center.x + (rng() * 2 - 1) * spreadX,
          z: anchor.center.z + (rng() * 2 - 1) * spreadZ,
        });
      }
      break;
    }
    case "around": {
      const radius = gap + (rel.distance ?? 2);
      if (group.size > 1) {
        // Each member of the group prefers its own evenly spaced slot.
        const slot = (group.index / group.size) * Math.PI * 2;
        const spread = (Math.PI * 2) / group.size / 3;
        for (let i = 0; i < 9; i++) {
          const angle = slot + (rng() * 2 - 1) * spread;
          const r = radius * (0.92 + rng() * 0.16);
          out.push({
            x: anchor.center.x + Math.cos(angle) * r,
            z: anchor.center.z + Math.sin(angle) * r,
          });
        }
      } else {
        ring(radius, 16);
      }
      break;
    }
    case "along_edge_of": {
      const count = 24;
      const offset = group.size > 1 ? group.index / group.size : rng();
      for (let i = 0; i < count; i++) {
        const t = offset + (i / count) * (group.size > 1 ? 1 / group.size : 1);
        if (anchor.region) out.push(regionEdgePoint(anchor.region, t));
        else {
          const angle = t * Math.PI * 2;
          const r = anchor.radius + item.radius + 0.2;
          out.push({
            x: anchor.center.x + Math.cos(angle) * r,
            z: anchor.center.z + Math.sin(angle) * r,
          });
        }
      }
      break;
    }
    case "inside_region": {
      for (let i = 0; i < 30; i++) {
        if (anchor.region) out.push(regionRandomPoint(anchor.region, rng, item.radius));
        else {
          const angle = rng() * Math.PI * 2;
          const r = Math.sqrt(rng()) * Math.max(anchor.radius - item.radius, 0.5);
          out.push({
            x: anchor.center.x + Math.cos(angle) * r,
            z: anchor.center.z + Math.sin(angle) * r,
          });
        }
      }
      break;
    }
    case "facing":
      break;
  }
  return out;
}

/** How well point p satisfies a relation: 1 is perfect, below 0.5 counts as unsatisfied. */
export function score(rel: Relation, anchor: Anchor, item: ItemShape, axes: ViewAxes, p: Point2) {
  if (anchor.polyline && POLYLINE_PREDICATES.has(rel.predicate)) {
    return polylineScore(rel, anchor, item, p);
  }
  const dx = p.x - anchor.center.x;
  const dz = p.z - anchor.center.z;
  const dist = Math.hypot(dx, dz);
  const gap = dist - anchor.radius - item.radius;

  switch (rel.predicate) {
    case "near": {
      const target = rel.distance ?? DEFAULT_NEAR;
      if (gap < -0.05) return -1;
      return gap <= target ? 1 : 1 - (gap - target) / target;
    }
    case "next_to": {
      const target = rel.distance ?? DEFAULT_NEXT_TO_GAP;
      if (gap < -0.05) return -1;
      return 1 - Math.abs(gap - target) / 2;
    }
    case "far_from": {
      const target = rel.distance ?? DEFAULT_FAR;
      return gap >= target ? 1 : gap / target - 0.2;
    }
    case "in_front_of":
    case "behind":
    case "left_of":
    case "right_of": {
      const dir = direction(rel.predicate, axes);
      const along = dx * dir.x + dz * dir.z;
      const lateral = Math.abs(dx * dir.z - dz * dir.x);
      const desired = anchor.radius + item.radius + (rel.distance ?? 1);
      if (along <= 0) return -1;
      return 1 - Math.abs(along - desired) / (desired + 2) - (lateral / (desired + 2)) * 0.5;
    }
    case "on_top_of": {
      const outX = Math.max(0, Math.abs(dx) - Math.max(anchor.halfX, 0.05));
      const outZ = Math.max(0, Math.abs(dz) - Math.max(anchor.halfZ, 0.05));
      return outX === 0 && outZ === 0 ? 1 : -Math.hypot(outX, outZ);
    }
    case "around": {
      const radius = anchor.radius + item.radius + (rel.distance ?? 2);
      return 1 - Math.abs(dist - radius) / radius;
    }
    case "along_edge_of": {
      const edge = anchor.region
        ? Math.abs(regionDistance(anchor.region, p))
        : Math.abs(dist - (anchor.radius + item.radius + 0.2));
      return 1 - edge / 2;
    }
    case "inside_region": {
      const d = anchor.region ? regionDistance(anchor.region, p) : dist - anchor.radius;
      return d <= -item.radius * 0.5 ? 1 : 1 - (d + item.radius) / 5;
    }
    case "facing":
      return 1;
  }
}

/** Default anchor footprint radius for a region (used by near/around a region). */
export function regionAnchorRadius(region: Region): number {
  return regionRadius(region);
}

function direction(predicate: Relation["predicate"], axes: ViewAxes): Point2 {
  switch (predicate) {
    case "in_front_of":
      return { x: -axes.forward.x, z: -axes.forward.z };
    case "behind":
      return axes.forward;
    case "left_of":
      return { x: -axes.right.x, z: -axes.right.z };
    default:
      return axes.right;
  }
}
