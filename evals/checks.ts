import { judgeWorld } from "@/agent/judge";
import { distanceToPolyline, pathPolyline, pathWidth } from "@/layout/paths";
import { nodeSize } from "@/layout/solver";
import type { SceneNode, World } from "@/scene/schema";
import { nearestWater, waterBodies } from "@/scene/terrain";

/**
 * Declarative assertions for eval cases. Each returns pass/fail plus a short
 * reason, so a failing run explains itself in the results table.
 */

export type Check =
  | { check: "env"; path: string; equals?: unknown; between?: [number, number] }
  | { check: "count"; tag: string; equals?: number; min?: number; max?: number; newOnly?: boolean }
  | { check: "none"; tag: string }
  | { check: "feature"; type: string; aroundOf?: string }
  | { check: "scaleIncreased"; id: string }
  | { check: "unchangedExcept"; ids: string[] }
  | { check: "near"; tag: string; target: string; max: number; min?: number; newOnly?: boolean }
  | { check: "alongPath"; tag: string; path: string; maxGap: number }
  | { check: "dry" }
  | { check: "nearWater"; tag: string; max: number; newOnly?: boolean }
  | { check: "region"; id: string }
  | { check: "judgeClean" };

export type CheckResult = { pass: boolean; detail: string };

/** A node matches a tag via its tags, its name, or its feature type. */
export function matches(node: SceneNode, tag: string): boolean {
  const t = tag.toLowerCase();
  return (
    node.tags.includes(t) || node.name.toLowerCase().includes(t) || node.procedural?.type === t
  );
}

export function runCheck(check: Check, before: World, after: World): CheckResult {
  const nodes = Object.values(after.nodes);
  const isNew = (n: SceneNode) => !before.nodes[n.id];

  switch (check.check) {
    case "env": {
      const value = check.path
        .split(".")
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], after.environment);
      if (check.between) {
        const [a, b] = check.between;
        const v = Number(value);
        // Wrapping ranges like [20, 4] for "night".
        const ok = a <= b ? v >= a && v <= b : v >= a || v <= b;
        return { pass: ok, detail: `${check.path}=${v}` };
      }
      return { pass: value === check.equals, detail: `${check.path}=${JSON.stringify(value)}` };
    }
    case "count": {
      const n = nodes.filter((x) => matches(x, check.tag) && (!check.newOnly || isNew(x))).length;
      const ok =
        (check.equals === undefined || n === check.equals) &&
        (check.min === undefined || n >= check.min) &&
        (check.max === undefined || n <= check.max);
      return { pass: ok, detail: `${n} ${check.tag}` };
    }
    case "none": {
      const left = nodes.filter((x) => matches(x, check.tag)).map((x) => x.id);
      return {
        pass: left.length === 0,
        detail: left.length ? `left: ${left.join(",")}` : "none left",
      };
    }
    case "feature": {
      const f = nodes.find((x) => x.procedural?.type === check.type);
      if (!f) return { pass: false, detail: `no ${check.type}` };
      if (check.aroundOf) {
        const ok =
          f.relations.some((r) => r.predicate === "around") ||
          f.relations.some((r) => r.target.includes(check.aroundOf!));
        return { pass: ok, detail: `${f.id} relations ${JSON.stringify(f.relations)}` };
      }
      return { pass: true, detail: f.id };
    }
    case "scaleIncreased": {
      const a = before.nodes[check.id];
      const b = after.nodes[check.id];
      if (!a || !b) return { pass: false, detail: `${check.id} missing` };
      const grew =
        b.transform.scale.every((v, i) => v >= a.transform.scale[i]!) &&
        b.transform.scale.some((v, i) => v > a.transform.scale[i]! * 1.05);
      return {
        pass: grew,
        detail: `${a.transform.scale.join("x")} -> ${b.transform.scale.join("x")}`,
      };
    }
    case "unchangedExcept": {
      const changed = Object.keys(before.nodes).filter(
        (id) =>
          !check.ids.includes(id) &&
          JSON.stringify(before.nodes[id]) !== JSON.stringify(after.nodes[id]),
      );
      const added = nodes.filter(isNew).map((n) => n.id);
      return {
        pass: changed.length === 0 && added.length === 0,
        detail: `changed ${changed.join(",") || "-"} added ${added.join(",") || "-"}`,
      };
    }
    case "near": {
      const target = centreOf(after, check.target);
      if (!target) return { pass: false, detail: `no target ${check.target}` };
      const hits = nodes.filter(
        (x) => matches(x, check.tag) && (!check.newOnly || isNew(x)) && !x.procedural,
      );
      if (hits.length === 0) return { pass: false, detail: `no ${check.tag}` };
      const dists = hits.map((x) =>
        Math.hypot(x.transform.position[0] - target.x, x.transform.position[2] - target.z),
      );
      const ok = dists.every((d) => d <= check.max && d >= (check.min ?? 0));
      return { pass: ok, detail: `dist ${dists.map((d) => d.toFixed(1)).join(",")}` };
    }
    case "alongPath": {
      const path = after.nodes[check.path];
      if (!path) return { pass: false, detail: `no ${check.path}` };
      const line = pathPolyline(after, path);
      const half = pathWidth(path) / 2;
      const hits = nodes.filter((x) => matches(x, check.tag) && !x.procedural);
      const gaps = hits.map((x) => {
        const r = Math.max(nodeSize(x)[0], nodeSize(x)[2]) / 2;
        return (
          distanceToPolyline(line, { x: x.transform.position[0], z: x.transform.position[2] }) -
          half -
          r
        );
      });
      const ok = hits.length > 0 && gaps.every((g) => g >= -0.05 && g <= check.maxGap);
      return { pass: ok, detail: `gaps ${gaps.map((g) => g.toFixed(2)).join(",")}` };
    }
    case "dry": {
      const water = waterBodies(after);
      const wet = nodes.filter(
        (n) =>
          (n.kind === "primitive" || n.kind === "asset") &&
          !["boat", "canoe", "lily", "duck"].some((t) => n.tags.includes(t)) &&
          (nearestWater(water, n.transform.position[0], n.transform.position[2])?.distance ?? 1) <
            -0.2,
      );
      return {
        pass: wet.length === 0,
        detail: wet.length ? `in water: ${wet.map((n) => n.id).join(",")}` : "dry",
      };
    }
    case "nearWater": {
      const water = waterBodies(after);
      const hits = nodes.filter(
        (x) => matches(x, check.tag) && (!check.newOnly || isNew(x)) && !x.procedural,
      );
      const gaps = hits.map(
        (x) =>
          nearestWater(water, x.transform.position[0], x.transform.position[2])?.distance ??
          Infinity,
      );
      const ok = hits.length > 0 && gaps.every((g) => g > -0.2 && g <= check.max);
      return {
        pass: ok,
        detail: `gaps to water ${gaps.map((g) => g.toFixed(1)).join(",") || "none"}`,
      };
    }
    case "region": {
      const region = after.regions[check.id];
      return {
        pass: Boolean(region),
        detail: region
          ? `${region.shape} at ${region.center.map((v) => v.toFixed(1)).join(",")}`
          : `regions: ${Object.keys(after.regions).join(",") || "none"}`,
      };
    }
    case "judgeClean": {
      const report = judgeWorld(after, new Set(Object.keys(after.nodes)));
      const problems = [...report.fixed, ...report.hard].map((i) => i.detail);
      return { pass: problems.length === 0, detail: problems.join("; ") || "clean" };
    }
  }
}

function centreOf(world: World, ref: string): { x: number; z: number } | null {
  const xy = ref.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (xy) return { x: Number(xy[1]), z: Number(xy[2]) };
  const n = world.nodes[ref] ?? Object.values(world.nodes).find((x) => matches(x, ref));
  if (n) return { x: n.transform.position[0], z: n.transform.position[2] };
  const r = world.regions[ref];
  return r ? { x: r.center[0], z: r.center[2] } : null;
}
