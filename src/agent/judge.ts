import { nodeSize } from "@/layout/solver";
import { scatterFeature, isScatterType } from "@/layout/scatter";
import { footprintAt, footprintsOverlap } from "@/layout/spatial-hash";
import type { SceneNode, Vec3, World } from "@/scene/schema";
import {
  WORLD_HALF_EXTENT,
  getWorldHeightField,
  nearestWater,
  waterBodies,
  waterLevelAt,
} from "@/scene/terrain";

/**
 * Deterministic judge, run after every agent turn (free, no model call).
 * Checks the nodes touched this turn. Simple problems get a position fix;
 * the rest come back as text for Claude.
 */

export type JudgeIssue = {
  nodeId?: string;
  kind:
    "floating" | "buried" | "in_water" | "overlap" | "out_of_bounds" | "too_many" | "broken_asset";
  detail: string;
};

export type JudgeReport = {
  /** New positions for nodes the judge can fix on its own. */
  fixes: Map<string, Vec3>;
  fixed: JudgeIssue[];
  /** Problems only Claude can sort out. */
  hard: JudgeIssue[];
};

const FLOAT_TOLERANCE = 0.2;
const BURY_TOLERANCE = 0.1;
const MIN_PENETRATION = 0.25;
const WORLD_MARGIN = 3;
export const MAX_NODES = 250;
export const MAX_INSTANCES = 3500;
const AQUATIC = new Set(["boat", "canoe", "kayak", "raft", "lily", "duck"]);

export function judgeWorld(
  world: World,
  touched: ReadonlySet<string>,
  broken: Record<string, string> = {},
): JudgeReport {
  const report: JudgeReport = { fixes: new Map(), fixed: [], hard: [] };
  const heightAt = getWorldHeightField(world);
  const waterMap = waterBodies(world);
  const solids = Object.values(world.nodes).filter(isSolid);
  const pos = (n: SceneNode) => report.fixes.get(n.id) ?? n.transform.position;
  const fix = (n: SceneNode, p: Vec3, issue: JudgeIssue) => {
    report.fixes.set(n.id, p.map((v) => Math.round(v * 1000) / 1000) as Vec3);
    report.fixed.push(issue);
  };

  for (const n of solids) {
    if (!touched.has(n.id)) continue;
    const size = nodeSize(n);
    const radius = Math.max(size[0], size[2]) / 2;
    const aquatic = n.tags.some((t) => AQUATIC.has(t));
    let [x, y, z] = pos(n);

    // Out of the world: clamp back inside.
    const limit = WORLD_HALF_EXTENT - WORLD_MARGIN;
    if (Math.abs(x) > limit || Math.abs(z) > limit) {
      x = Math.max(-limit, Math.min(limit, x));
      z = Math.max(-limit, Math.min(limit, z));
      fix(n, [x, heightAt(x, z), z], {
        nodeId: n.id,
        kind: "out_of_bounds",
        detail: `${n.id} was outside the world; moved inside`,
      });
    }

    // Land objects standing in a lake or river: push out to the bank.
    if (!aquatic) {
      const hit = nearestWater(waterMap, x, z);
      if (hit && hit.distance < -0.2) {
        const push = -hit.distance + radius + 0.5;
        x += hit.away.x * push;
        z += hit.away.z * push;
        fix(n, [x, heightAt(x, z), z], {
          nodeId: n.id,
          kind: "in_water",
          detail: `${n.id} was in the water; moved to the bank`,
        });
      }
    }

    // Vertical: on its support, on the water, or on the ground.
    const support = stackedOn(world, n);
    const water = aquatic ? waterLevelAt(world, x, z) : null;
    const expected = support ? support : (water ?? heightAt(x, z));
    [x, y, z] = pos(n);
    if (y > expected + FLOAT_TOLERANCE) {
      fix(n, [x, expected, z], {
        nodeId: n.id,
        kind: "floating",
        detail: `${n.id} was floating ${(y - expected).toFixed(1)}m up; set down`,
      });
    } else if (y < expected - BURY_TOLERANCE) {
      fix(n, [x, expected, z], {
        nodeId: n.id,
        kind: "buried",
        detail: `${n.id} was ${(expected - y).toFixed(1)}m below ground; raised`,
      });
    }
  }

  // Overlaps: nudge the touched object out along the centre line, a few times.
  for (const n of solids) {
    if (!touched.has(n.id)) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      const other = solids.find(
        (o) => o.id !== n.id && overlapDepth(n, o, pos) > MIN_PENETRATION && !related(n, o),
      );
      if (!other) break;
      const [x, , z] = pos(n);
      const [ox, , oz] = pos(other);
      const d = Math.hypot(x - ox, z - oz) || 0.01;
      const push = overlapDepth(n, other, pos) + 0.15;
      const nx = x + ((x - ox) / d) * push;
      const nz = z + ((z - oz) / d) * push;
      fix(n, [nx, stackedOn(world, n) ?? heightAt(nx, nz), nz], {
        nodeId: n.id,
        kind: "overlap",
        detail: `${n.id} overlapped ${other.id}; pushed apart`,
      });
    }
    const still = solids.find(
      (o) => o.id !== n.id && overlapDepth(n, o, pos) > MIN_PENETRATION && !related(n, o),
    );
    if (still) {
      report.hard.push({
        nodeId: n.id,
        kind: "overlap",
        detail: `${n.id} still overlaps ${still.id}; move one of them (e.g. new relations)`,
      });
    }
  }

  // Budget and loading problems need a decision, not a nudge.
  const nodeCount = Object.keys(world.nodes).length;
  if (nodeCount > MAX_NODES) {
    report.hard.push({
      kind: "too_many",
      detail: `${nodeCount} nodes is too many for smooth frame rates; merge copies into add_procedural features or remove some`,
    });
  }
  const instances = Object.values(world.nodes)
    .filter((n) => isScatterType(n.procedural?.type))
    .reduce((sum, n) => sum + scatterFeature(world, n).length, 0);
  if (instances > MAX_INSTANCES) {
    report.hard.push({
      kind: "too_many",
      detail: `${instances} instanced plants/rocks is over the ${MAX_INSTANCES} budget; lower some counts`,
    });
  }
  for (const n of Object.values(world.nodes)) {
    if (touched.has(n.id) && n.asset && broken[n.asset.url]) {
      report.hard.push({
        nodeId: n.id,
        kind: "broken_asset",
        detail: `${n.id}'s model failed to load; replace it with another asset_query or a shape`,
      });
    }
  }
  return report;
}

export function formatJudge(report: JudgeReport): string {
  const lines = ["JUDGE: automatic layout check after your changes."];
  if (report.fixed.length) lines.push(`Fixed: ${report.fixed.map((i) => i.detail).join("; ")}.`);
  if (report.hard.length)
    lines.push(`Needs your attention: ${report.hard.map((i) => i.detail).join("; ")}.`);
  lines.push("Fix what needs attention with tools, then stop. Do not repeat earlier changes.");
  return lines.join("\n");
}

function isSolid(n: SceneNode): boolean {
  return n.kind === "primitive" || n.kind === "asset";
}

/** y of the surface this node sits on, if it is placed on top of another node. */
function stackedOn(world: World, n: SceneNode): number | null {
  const rel = n.relations.find((r) => r.predicate === "on_top_of");
  const base = rel ? world.nodes[rel.target] : undefined;
  return base ? base.transform.position[1] + nodeSize(base)[1] : null;
}

/** Stacked or parented pairs are meant to overlap. */
function related(a: SceneNode, b: SceneNode): boolean {
  const on = (x: SceneNode, y: SceneNode) =>
    x.relations.some((r) => r.predicate === "on_top_of" && r.target === y.id);
  return on(a, b) || on(b, a) || a.parentId === b.id || b.parentId === a.id;
}

/** How deep two footprints interpenetrate (0 when they don't), using the shallower axis. */
function overlapDepth(a: SceneNode, b: SceneNode, pos: (n: SceneNode) => Vec3): number {
  const sa = nodeSize(a);
  const sb = nodeSize(b);
  const [ax, , az] = pos(a);
  const [bx, , bz] = pos(b);
  const fa = footprintAt(ax, az, sa[0], sa[2]);
  const fb = footprintAt(bx, bz, sb[0], sb[2]);
  if (!footprintsOverlap(fa, fb)) return 0;
  const dx = Math.min(fa.maxX, fb.maxX) - Math.max(fa.minX, fb.minX);
  const dz = Math.min(fa.maxZ, fb.maxZ) - Math.max(fa.minZ, fb.minZ);
  return Math.min(dx, dz);
}
