import { nodeSize } from "@/layout/solver";
import type { CameraState, SceneNode, Vec3, World } from "@/scene/schema";

/**
 * Compact text summary of the scene for each agent turn. Never the full JSON:
 * one line per node, repeated items grouped once the scene gets large.
 */

export type SummaryContext = {
  selection: string | null;
  pointer: Vec3 | null;
  camera: CameraState;
};

const GROUP_THRESHOLD = 60;

export function buildSceneSummary(world: World, ctx: SummaryContext): string {
  const env = world.environment;
  const lines: string[] = [];

  lines.push(
    `ENV: time ${env.timeOfDay.toFixed(1)} (${timeLabel(env.timeOfDay)}), sky ${env.sky}, ` +
      `fog ${env.fog.enabled ? `on (${env.fog.density}, ${env.fog.color})` : "off"}, stars ${env.stars ? "on" : "off"}, ` +
      `weather ${env.weather}, terrain ${env.terrain.type} seed ${env.terrain.seed} height ${env.terrain.height}m`,
  );

  const regions = Object.values(world.regions);
  lines.push(
    regions.length
      ? `REGIONS: ${regions.map((r) => `${r.id} ${r.shape} c${fmt(r.center)} size ${r.size[0]}x${r.size[2]}m`).join("; ")}`
      : "REGIONS: none",
  );

  const nodes = Object.values(world.nodes);
  lines.push(`NODES (${nodes.length}):`);
  if (nodes.length === 0) lines.push(" (empty)");
  else if (nodes.length <= GROUP_THRESHOLD) for (const n of nodes) lines.push(` ${nodeLine(n)}`);
  else lines.push(...groupedLines(nodes));

  const selected = ctx.selection ? world.nodes[ctx.selection] : undefined;
  lines.push(`SELECTION: ${selected ? `${selected.id} "${selected.name}"` : "none"}`);
  lines.push(
    `POINTER: ${ctx.pointer ? `ground hit at ${fmt(ctx.pointer)}` : "none (use the view centre)"}`,
  );
  lines.push(`CAMERA: looking at ${fmt(ctx.camera.target)} from ${fmt(ctx.camera.position)}`);
  return lines.join("\n");
}

function nodeLine(n: SceneNode): string {
  if (n.procedural) return featureLine(n);
  const kind =
    n.kind === "primitive"
      ? `primitive ${n.primitive}`
      : n.kind === "asset"
        ? `model(${n.asset?.source})`
        : n.kind;
  const size = nodeSize(n)
    .map((v) => +v.toFixed(1))
    .join("x");
  const colour = n.material?.color ? ` ${n.material.color}` : "";
  const rels = n.relations.length
    ? ` ${n.relations.map((r) => `${r.predicate} ${r.target}`).join(", ")},`
    : "";
  const tags = n.tags.length ? ` [${n.tags.join(",")}]` : "";
  return `${n.id} ${kind} "${n.name}" @${fmt(n.transform.position)}${rels} ${size}m${colour}${tags}`;
}

/** Nature features read better as what they are than as boxes. */
function featureLine(n: SceneNode): string {
  const p = n.procedural!.params;
  const at = fmt(n.transform.position);
  switch (n.procedural!.type) {
    case "lake":
      return `${n.id} lake r${p.radius}m water@${at}`;
    case "path":
      return `${n.id} path ${String(p.from)} -> ${String(p.to)}, ${p.width}m wide`;
    default: {
      const area = p.innerRadius
        ? `ring ${Number(p.innerRadius).toFixed(0)}-${Number(p.radius).toFixed(0)}m`
        : `r${Number(p.radius).toFixed(0)}m`;
      const rel = n.relations[0] ? ` ${n.relations[0].predicate} ${n.relations[0].target}` : "";
      const kind = p.species ? `${n.procedural!.type} (${String(p.species)})` : n.procedural!.type;
      return `${n.id} ${kind} x${p.count ?? "?"} ${area}${rel} centre ${at}`;
    }
  }
}

function groupedLines(nodes: SceneNode[]): string[] {
  const groups = new Map<string, SceneNode[]>();
  for (const n of nodes) {
    const key = n.name;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const out: string[] = [];
  for (const [name, members] of groups) {
    if (members.length <= 3) {
      for (const n of members) out.push(` ${nodeLine(n)}`);
      continue;
    }
    const xs = members.map((n) => n.transform.position[0]);
    const zs = members.map((n) => n.transform.position[2]);
    const centre: Vec3 = [avg(xs), 0, avg(zs)];
    const spread = Math.max(
      ...members.map((n) =>
        Math.hypot(n.transform.position[0] - centre[0], n.transform.position[2] - centre[2]),
      ),
    );
    const first = members[0]!;
    const rel = first.relations[0]
      ? ` ${first.relations[0].predicate} ${first.relations[0].target},`
      : "";
    out.push(
      ` "${name}" x${members.length} (${members[0]!.id}..${members.at(-1)!.id})${rel} centre ${fmt(centre)} spread r${spread.toFixed(0)}m [${first.tags.join(",")}]`,
    );
  }
  return out;
}

export function timeLabel(t: number): string {
  if (t < 5 || t >= 20.5) return "night";
  if (t < 7) return "dawn";
  if (t < 11) return "morning";
  if (t < 14) return "midday";
  if (t < 16.5) return "afternoon";
  if (t < 18) return "golden hour";
  if (t < 19) return "sunset";
  return "dusk";
}

function fmt(v: Vec3): string {
  return `(${v.map((n) => +n.toFixed(1)).join(",")})`;
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
