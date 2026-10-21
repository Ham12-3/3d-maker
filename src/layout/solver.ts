import { createRng } from "@/lib/random";
import type { CameraState, Relation, SceneNode, Vec3, World } from "@/scene/schema";
import {
  WORLD_HALF_EXTENT,
  getWorldHeightField,
  lakesOf,
  waterLevelAt,
  type HeightField,
} from "@/scene/terrain";
import { distanceToPolyline, pathPolyline, pathWidth } from "./paths";
import {
  POSITIONAL,
  candidates,
  regionAnchorRadius,
  score,
  type Anchor,
  type Group,
  type ItemShape,
  type ViewAxes,
} from "./predicates";
import type { Point2 } from "./regions";
import { SpatialHash, footprintAt } from "./spatial-hash";

/**
 * Layout solver: turns relations ("next to the sphere", "around the lake")
 * into coordinates. Pure and deterministic for a given seed. No React.
 */

export type PlacementItem = {
  id: string;
  /** Bounds in metres: [width, height, depth]. */
  size: Vec3;
  relations: Relation[];
  /** Region id to place inside (shortcut for an inside_region relation). */
  region?: string;
  /** Explicit position given by the user; only snapped to the ground. */
  position?: Vec3;
  group?: Group;
  /** Boats, lily pads: belong on water instead of being kept out of it. */
  aquatic?: boolean;
};

export type SolveContext = {
  pointer: Vec3 | null;
  camera: CameraState;
  seed: number;
};

export type Placement = {
  id: string;
  position: Vec3;
  rotation: Vec3;
  /** Human-readable notes for relations that could not be met. */
  unsatisfied: string[];
};

const WORLD_MARGIN = 5;
const SATISFIED = 0.5;
/** Nodes thinner than this (rugs, decals) don't block placement. */
const MIN_BLOCKING_HEIGHT = 0.05;

export function solvePlacements(
  world: World,
  items: PlacementItem[],
  ctx: SolveContext,
): Placement[] {
  const heightAt = getWorldHeightField(world);
  const axes = viewAxes(ctx.camera);
  const hash = new SpatialHash();
  const placed = new Map<string, { position: Vec3; size: Vec3; rotationY: number }>();
  const lakes = lakesOf(world);
  const paths = Object.values(world.nodes)
    .filter((n) => n.procedural?.type === "path")
    .map((n) => ({ points: pathPolyline(world, n), half: pathWidth(n) / 2 }));

  for (const node of Object.values(world.nodes)) {
    if (!blocksPlacement(node)) continue;
    const size = nodeSize(node);
    const [hx, hz] = rotatedHalfExtents(size, node.transform.rotation[1]);
    hash.insert(
      node.id,
      footprintAt(node.transform.position[0], node.transform.position[2], hx * 2, hz * 2),
    );
  }

  const lookup = (id: string) => {
    const p = placed.get(id);
    if (p) return p;
    const node = world.nodes[id];
    return node
      ? {
          position: node.transform.position,
          size: nodeSize(node),
          rotationY: node.transform.rotation[1],
        }
      : undefined;
  };

  return items.map((item) => {
    const rng = createRng(ctx.seed ^ hashString(item.id));
    const shape: ItemShape = {
      radius: Math.max(item.size[0], item.size[2]) / 2,
      halfX: item.size[0] / 2,
      halfZ: item.size[2] / 2,
    };
    const group = item.group ?? { index: 0, size: 1 };
    const unsatisfied: string[] = [];

    const relations = [...item.relations];
    if (item.region && !relations.some((r) => r.predicate === "inside_region")) {
      relations.push({ predicate: "inside_region", target: item.region });
    }

    const resolved: { rel: Relation; anchor: Anchor }[] = [];
    for (const rel of relations) {
      const anchor = resolveAnchor(rel.target, world, lookup, ctx, heightAt);
      if (!anchor) unsatisfied.push(`unknown target "${rel.target}" for ${rel.predicate}`);
      else resolved.push({ rel, anchor });
    }
    const positional = resolved.filter((r) => POSITIONAL.has(r.rel.predicate));
    const stackedOn = positional.find((r) => r.rel.predicate === "on_top_of")?.anchor.nodeId;

    let best: Point2;
    if (item.position) {
      best = { x: item.position[0], z: item.position[2] };
    } else {
      // Nothing positional: drop it near the pointer, or the centre of the view.
      if (positional.length === 0) {
        const anchor = resolveAnchor("pointer", world, lookup, ctx, heightAt)!;
        positional.push({ rel: { predicate: "near", target: "pointer", distance: 3 }, anchor });
      }
      const pool = positional.flatMap(({ rel, anchor }) =>
        candidates(rel, anchor, shape, axes, rng, group),
      );
      best = pickBest(pool, (p) => {
        const relScore =
          positional.reduce((sum, { rel, anchor }) => sum + score(rel, anchor, shape, axes, p), 0) /
          positional.length;
        const fp = footprintAt(p.x, p.z, shape.halfX * 2, shape.halfZ * 2);
        const overlaps = hash.query(fp, 0.05).filter((id) => id !== item.id && id !== stackedOn);
        const outside =
          Math.abs(p.x) > WORLD_HALF_EXTENT - WORLD_MARGIN ||
          Math.abs(p.z) > WORLD_HALF_EXTENT - WORLD_MARGIN;
        // Land things stay out of lakes and off paths; boats want the water.
        const wet = lakes.some(
          (l) =>
            Math.hypot(p.x - l.x, p.z - l.z) <
            l.radius + (item.aquatic ? -shape.radius : shape.radius * 0.6),
        );
        const onPath =
          !stackedOn &&
          paths.some((path) => distanceToPolyline(path.points, p) < path.half + shape.radius * 0.5);
        return (
          relScore -
          overlaps.length * 2 -
          (outside ? 10 : 0) -
          (wet !== Boolean(item.aquatic) ? 4 : 0) -
          (onPath ? 2 : 0) +
          (inView(ctx.camera, p) ? 0.15 : 0)
        );
      });
    }

    for (const { rel, anchor } of positional) {
      if (score(rel, anchor, shape, axes, best) < SATISFIED) {
        unsatisfied.push(`${rel.predicate} ${rel.target}`);
      }
    }

    const onTop = positional.find(
      (r) =>
        r.rel.predicate === "on_top_of" && score(r.rel, r.anchor, shape, axes, best) >= SATISFIED,
    );
    const ground = heightAt(best.x, best.z);
    const water = item.aquatic ? waterLevelAt(world, best.x, best.z) : null;
    const y = onTop
      ? onTop.anchor.top
      : water !== null
        ? water
        : item.position
          ? Math.max(item.position[1], ground)
          : ground;

    const facing = resolved.find((r) => r.rel.predicate === "facing");
    const rotationY = facing ? yawTowards(best, facing.anchor.center) : 0;

    const position: Vec3 = [round(best.x), round(y), round(best.z)];
    placed.set(item.id, { position, size: item.size, rotationY });
    if (item.size[1] >= MIN_BLOCKING_HEIGHT) {
      hash.insert(item.id, footprintAt(best.x, best.z, shape.halfX * 2, shape.halfZ * 2));
    }
    return { id: item.id, position, rotation: [0, round(rotationY), 0], unsatisfied };
  });
}

/**
 * After nodes move, carry along everything that was placed relative to them
 * (move the table, the cup follows), and re-aim anything facing them.
 * Mutates `world` in place, so pass an Immer draft. Returns the ids it moved.
 */
export function followMovedAnchors(
  world: World,
  movedIds: string[],
  before: Map<string, Vec3>,
): string[] {
  const heightAt = getWorldHeightField(world);
  const deltas = new Map<string, Point2>();
  for (const id of movedIds) {
    const prev = before.get(id);
    const node = world.nodes[id];
    if (!prev || !node) continue;
    deltas.set(id, {
      x: node.transform.position[0] - prev[0],
      z: node.transform.position[2] - prev[2],
    });
  }

  const followed: string[] = [];
  const queue = [...deltas.keys()];
  while (queue.length > 0) {
    const anchorId = queue.shift()!;
    const delta = deltas.get(anchorId)!;
    const anchor = world.nodes[anchorId];
    for (const node of Object.values(world.nodes)) {
      if (deltas.has(node.id)) continue;
      const rel = node.relations.find((r) => r.target === anchorId && POSITIONAL.has(r.predicate));
      if (!rel) continue;
      const pos = node.transform.position;
      const x = pos[0] + delta.x;
      const z = pos[2] + delta.z;
      const y =
        rel.predicate === "on_top_of" && anchor
          ? anchor.transform.position[1] + nodeSize(anchor)[1]
          : heightAt(x, z);
      node.transform.position = [round(x), round(y), round(z)];
      deltas.set(node.id, delta);
      followed.push(node.id);
      queue.push(node.id);
    }
  }

  // Re-aim facing relations whose subject or target moved.
  for (const node of Object.values(world.nodes)) {
    const facing = node.relations.find((r) => r.predicate === "facing");
    if (!facing || !(deltas.has(node.id) || deltas.has(facing.target))) continue;
    const target = world.nodes[facing.target] ?? null;
    const region = world.regions[facing.target] ?? null;
    const center = target
      ? { x: target.transform.position[0], z: target.transform.position[2] }
      : region
        ? { x: region.center[0], z: region.center[2] }
        : null;
    if (!center) continue;
    const yaw = yawTowards(
      { x: node.transform.position[0], z: node.transform.position[2] },
      center,
    );
    node.transform.rotation = [node.transform.rotation[0], round(yaw), node.transform.rotation[2]];
  }
  return followed;
}

/** Size in metres. Primitives are unit-sized, so their scale is their size. */
export function nodeSize(node: SceneNode): Vec3 {
  return node.bounds ?? node.transform.scale;
}

function resolveAnchor(
  target: string,
  world: World,
  lookup: (id: string) => { position: Vec3; size: Vec3; rotationY: number } | undefined,
  ctx: SolveContext,
  heightAt: HeightField,
): Anchor | null {
  const point = (x: number, z: number): Anchor => ({
    center: { x, z },
    radius: 0,
    halfX: 0,
    halfZ: 0,
    top: heightAt(x, z),
  });

  switch (target) {
    case "origin":
      return point(0, 0);
    case "camera":
      return point(ctx.camera.position[0], ctx.camera.position[2]);
    case "pointer":
      return ctx.pointer
        ? point(ctx.pointer[0], ctx.pointer[2])
        : point(ctx.camera.target[0], ctx.camera.target[2]);
  }

  const pathNode = world.nodes[target];
  if (pathNode?.procedural?.type === "path") {
    const polyline = pathPolyline(world, pathNode);
    const mid = polyline[Math.floor(polyline.length / 2)]!;
    return { ...point(mid.x, mid.z), radius: pathWidth(pathNode) / 2, polyline, nodeId: target };
  }

  const node = lookup(target);
  if (node) {
    const [hx, hz] = rotatedHalfExtents(node.size, node.rotationY);
    return {
      center: { x: node.position[0], z: node.position[2] },
      radius: Math.max(node.size[0], node.size[2]) / 2,
      halfX: hx,
      halfZ: hz,
      top: node.position[1] + node.size[1],
      nodeId: target,
    };
  }

  const region = world.regions[target];
  if (region) {
    return {
      ...point(region.center[0], region.center[2]),
      radius: regionAnchorRadius(region),
      region,
    };
  }
  return null;
}

function pickBest(pool: Point2[], evaluate: (p: Point2) => number): Point2 {
  let best = pool[0] ?? { x: 0, z: 0 };
  let bestScore = -Infinity;
  for (const p of pool) {
    const s = evaluate(p);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

function viewAxes(camera: CameraState): ViewAxes {
  const fx = camera.target[0] - camera.position[0];
  const fz = camera.target[2] - camera.position[2];
  const len = Math.hypot(fx, fz) || 1;
  const forward = { x: fx / len, z: fz / len };
  return { forward, right: { x: -forward.z, z: forward.x } };
}

function inView(camera: CameraState, p: Point2): boolean {
  const { forward } = viewAxes(camera);
  const dx = p.x - camera.position[0];
  const dz = p.z - camera.position[2];
  const len = Math.hypot(dx, dz) || 1;
  const cos = (dx * forward.x + dz * forward.z) / len;
  return cos > Math.cos(((camera.fov / 2) * Math.PI) / 180);
}

/** Yaw (rotation about Y) that turns local +Z towards the target. */
function yawTowards(from: Point2, to: Point2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function rotatedHalfExtents(size: Vec3, yaw: number): [number, number] {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  return [(c * size[0] + s * size[2]) / 2, (s * size[0] + c * size[2]) / 2];
}

function blocksPlacement(node: SceneNode): boolean {
  return (
    (node.kind === "primitive" || node.kind === "asset") && nodeSize(node)[1] >= MIN_BLOCKING_HEIGHT
  );
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
