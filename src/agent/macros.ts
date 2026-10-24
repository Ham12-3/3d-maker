import { nextNodeId } from "@/scene/ops";
import type { Macro, Relation, World } from "@/scene/schema";
import type { RecordedStep } from "./tools/types";

/**
 * Macros ("library learning", after SceneCraft): a reusable recipe of tool
 * calls. Recipes never hold coordinates or concrete ids:
 * - things the recipe creates are placeholders ("$well", "$square"),
 * - everything outside it (a lake, the pointer, "x,z" points) is "$anchor".
 * Applying binds the anchor ("by the river") and picks fresh ids, then runs
 * the steps through the normal tools, so the solver places everything anew.
 * Water built in the same command is the setting, not the thing (see
 * `withoutSetting`), so it becomes the anchor too.
 */

export type MacroStep = Macro["steps"][number];

/** Keys whose string values name things in the world. */
const REF_KEYS = new Set(["target", "region", "from", "to"]);
const ANCHOR = "$anchor";

/** Turn the steps a command recorded into a portable recipe. */
export function generaliseSteps(recorded: RecordedStep[], world: World): MacroStep[] {
  const steps = withoutSetting(recorded);
  const placeholder = new Map<string, string>();
  const used = new Set<string>();
  const nameFor = (id: string) => {
    const base = `$${id.replace(/_\d+$/, "")}`;
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}${i}`;
    used.add(name);
    return name;
  };

  // add_objects specs get the placeholder of the first copy they created;
  // later copies map to the same placeholder.
  const out: MacroStep[] = steps.map((step) => {
    const input = structuredClone(step.input) as Record<string, unknown>;
    if (step.tool === "add_objects") {
      const specs = (input.objects as Record<string, unknown>[]) ?? [];
      let offset = 0;
      for (const spec of specs) {
        const count = Number(spec.count ?? 1);
        const first = step.created[offset];
        if (first) {
          const ph = placeholder.get(first) ?? nameFor(first);
          for (const id of step.created.slice(offset, offset + count)) placeholder.set(id, ph);
          spec.id = ph;
        }
        delete spec.position;
        offset += count;
      }
    } else if (step.tool === "add_procedural" || step.tool === "create_region") {
      const first = step.tool === "create_region" ? step.regions[0] : step.created[0];
      if (first) {
        const ph = nameFor(first);
        placeholder.set(first, ph);
        input.id = ph;
      }
    }
    return { tool: step.tool, input };
  });

  const isWorldRef = (v: string) =>
    v === "pointer" ||
    v === "there" ||
    v in world.nodes ||
    v in world.regions ||
    /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(v);
  for (const step of out) {
    walk(step.input, (key, value) => {
      if (!REF_KEYS.has(key)) return value;
      if (placeholder.has(value)) return placeholder.get(value)!;
      return isWorldRef(value) ? ANCHOR : value;
    });
  }
  return out;
}

const WATER = new Set(["lake", "river"]);

/**
 * "A campsite by a lake" saved as a recipe is the campsite: re-applying it
 * "on the other side of the lake" or "by the river" must not dig another
 * lake. Lakes and rivers, and nature features placed relative to them (a
 * forest around the lake), are left out; references to them become the
 * anchor. A recipe that is only setting (just a lake) is kept whole.
 */
function withoutSetting(steps: RecordedStep[]): RecordedStep[] {
  const water = new Set<string>();
  const drop = new Set<RecordedStep>();
  for (const step of steps) {
    const type = (step.input as { type?: string } | null)?.type;
    if (step.tool === "add_procedural" && type && WATER.has(type)) {
      drop.add(step);
      step.created.forEach((id) => water.add(id));
    }
  }
  for (const step of steps) {
    if (step.tool === "add_procedural" && refsOf(step.input).some((r) => water.has(r))) {
      drop.add(step);
    }
  }
  const kept = steps.filter((s) => !drop.has(s));
  return kept.some((s) => s.tool !== "set_environment") ? kept : steps;
}

function refsOf(input: unknown): string[] {
  const refs: string[] = [];
  walk(structuredClone(input), (key, value) => {
    if (REF_KEYS.has(key)) refs.push(value);
    return value;
  });
  return refs;
}

export type Anchor = { target: string; predicate?: Relation["predicate"]; distance?: number };

/**
 * Concrete tool calls for a recipe: fresh ids for every placeholder, the
 * anchor bound, and things with no placement at all put near the anchor.
 */
export function instantiateMacro(
  macro: Pick<Macro, "steps">,
  world: World,
  anchor: Anchor,
): { tool: string; input: Record<string, unknown> }[] {
  const steps = structuredClone(macro.steps) as { tool: string; input: Record<string, unknown> }[];
  const ids = new Map<string, string>();
  // Regions share the id space with nodes in practice ("square_1").
  const taken = new Set<string>(Object.keys(world.regions));
  const idFor = (ph: string) => {
    if (!ids.has(ph)) {
      const id = nextNodeId(world, ph.slice(1).replace(/\d+$/, "") || "thing", taken);
      taken.add(id);
      ids.set(ph, id);
    }
    return ids.get(ph)!;
  };

  for (const step of steps) {
    walk(step.input, (key, value) => {
      if (key === "id" && value.startsWith("$")) return idFor(value);
      if (REF_KEYS.has(key) && value === ANCHOR) return anchor.target;
      if (REF_KEYS.has(key) && value.startsWith("$")) return idFor(value);
      return value;
    });
    // Anchor relations take the requested predicate/distance when given.
    walkRelations(step.input, (rel) => {
      if (rel.target !== anchor.target) return;
      if (anchor.predicate) rel.predicate = anchor.predicate;
      if (anchor.distance !== undefined) rel.distance = anchor.distance;
    });
    // Unplaced things go by the anchor.
    const placeable =
      step.tool === "add_objects"
        ? ((step.input.objects as Record<string, unknown>[]) ?? [])
        : [step.input];
    if (
      step.tool === "add_objects" ||
      step.tool === "add_procedural" ||
      step.tool === "create_region"
    ) {
      for (const item of placeable) {
        const rels = (item.relations as Relation[] | undefined) ?? [];
        const placed = rels.length > 0 || item.region || item.from || item.position;
        if (!placed && item.type !== "path") {
          item.relations = [
            {
              predicate: anchor.predicate ?? "near",
              target: anchor.target,
              ...(anchor.distance ? { distance: anchor.distance } : {}),
            },
          ];
        }
      }
    }
  }
  return steps;
}

export function findMacro(world: World, name: string): Macro | undefined {
  const id = slug(name);
  return (
    world.macros[id] ??
    BUILT_IN_MACROS[id] ??
    Object.values(world.macros).find((m) => slug(m.name) === id)
  );
}

export function macroId(name: string): string {
  return slug(name);
}

export function listMacros(world: World): { id: string; builtIn: boolean; description: string }[] {
  const all = { ...BUILT_IN_MACROS, ...world.macros };
  return Object.values(all).map((m) => ({
    id: m.id,
    builtIn: m.builtIn,
    description: m.description,
  }));
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "macro"
  );
}

/** Rewrite every string value under `node`, given its key. */
function walk(node: unknown, fn: (key: string, value: string) => string): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, fn);
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") obj[key] = fn(key, value);
      else walk(value, fn);
    }
  }
}

function walkRelations(node: unknown, fn: (rel: Relation) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkRelations(item, fn);
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.relations)) for (const rel of obj.relations as Relation[]) fn(rel);
    for (const value of Object.values(obj))
      if (value && typeof value === "object") walkRelations(value, fn);
  }
}

const builtIn = (id: string, description: string, steps: MacroStep[]): Macro => ({
  id,
  name: id.replace(/_/g, " "),
  description,
  steps,
  builtIn: true,
});

/** The five recipes that ship with the app. `$anchor` is where it gets built. */
export const BUILT_IN_MACROS: Record<string, Macro> = {
  spooky: builtIn("spooky", "Dim cold night, thick fog, dead trees and rocks", [
    {
      tool: "set_environment",
      input: {
        timeOfDay: 20.8,
        sky: "night",
        stars: false,
        fog: { enabled: true, color: "#1b2230", density: 0.028 },
        sun: { intensity: 0.5, color: "#9fb3d9" },
        ambient: { intensity: 0.35, color: "#6d7fa3" },
        postfx: { vignette: 0.6, saturation: 0.6 },
      },
    },
    {
      tool: "add_procedural",
      input: {
        type: "forest",
        id: "$dead_forest",
        species: "dead",
        count: 28,
        radius: 18,
        relations: [{ predicate: "near", target: ANCHOR }],
      },
    },
    {
      tool: "add_procedural",
      input: {
        type: "rocks",
        id: "$rocks",
        count: 14,
        radius: 9,
        relations: [{ predicate: "near", target: ANCHOR }],
      },
    },
    {
      tool: "add_procedural",
      input: {
        type: "fireflies",
        id: "$wisps",
        count: 40,
        radius: 10,
        relations: [{ predicate: "near", target: ANCHOR }],
      },
    },
  ]),
  cosy_village: builtIn(
    "cosy_village",
    "Golden-hour village square: a well, three cottages, benches, lanterns, flowers",
    [
      {
        tool: "set_environment",
        input: {
          timeOfDay: 17.4,
          sky: "sunset",
          fog: { enabled: true, color: "#f0b98d", density: 0.006 },
        },
      },
      {
        tool: "create_region",
        input: {
          id: "$square",
          shape: "circle",
          size: [24, 24],
          relations: [{ predicate: "near", target: ANCHOR, distance: 4 }],
        },
      },
      {
        tool: "add_objects",
        input: {
          objects: [
            {
              id: "$well",
              name: "stone well",
              asset_query: "stone well",
              shape: "cylinder",
              size: [2.2, 1.4, 2.2],
              material: { color: "#9b958a" },
              tags: ["well"],
              region: "$square",
            },
            {
              id: "$cottage",
              name: "cottage",
              asset_query: "cottage",
              size: [6, 5, 6],
              count: 3,
              tags: ["house", "cottage"],
              relations: [
                { predicate: "around", target: "$well", distance: 8 },
                { predicate: "facing", target: "$well" },
              ],
            },
            {
              id: "$bench",
              name: "bench",
              asset_query: "bench",
              count: 2,
              tags: ["bench"],
              relations: [
                { predicate: "around", target: "$well", distance: 2.5 },
                { predicate: "facing", target: "$well" },
              ],
            },
            {
              id: "$lantern",
              name: "lantern",
              asset_query: "lantern",
              count: 4,
              tags: ["lantern"],
              relations: [{ predicate: "around", target: "$well", distance: 5 }],
            },
          ],
        },
      },
      {
        tool: "add_procedural",
        input: { type: "flowers", id: "$flowers", count: 70, region: "$square" },
      },
    ],
  ),
  tropical_island: builtIn(
    "tropical_island",
    "Sunny island in a turquoise sea with palms, rocks and a beach hut",
    [
      {
        tool: "set_environment",
        input: {
          terrain: { type: "island", height: 6, color: "#86b85a" },
          timeOfDay: 13,
          sky: "clear",
          fog: { enabled: false },
          postfx: { saturation: 1.15 },
        },
      },
      {
        tool: "add_procedural",
        input: {
          type: "forest",
          id: "$palms",
          species: "palm",
          count: 26,
          radius: 22,
          relations: [{ predicate: "near", target: "origin", distance: 0.1 }],
        },
      },
      {
        tool: "add_procedural",
        input: {
          type: "rocks",
          id: "$beach_rocks",
          count: 12,
          radius: 14,
          relations: [{ predicate: "near", target: "origin", distance: 0.1 }],
        },
      },
      {
        tool: "add_objects",
        input: {
          objects: [
            {
              id: "$hut",
              name: "beach hut",
              asset_query: "beach hut",
              size: [5, 4, 5],
              tags: ["hut", "house"],
              relations: [{ predicate: "near", target: ANCHOR }],
            },
          ],
        },
      },
    ],
  ),
  winter_wonderland: builtIn(
    "winter_wonderland",
    "Snowfall, white ground, snowy pines, snowmen and a sled",
    [
      {
        tool: "set_environment",
        input: {
          weather: "snow",
          timeOfDay: 11.5,
          sky: "overcast",
          terrain: { color: "#e6ecf1" },
          fog: { enabled: true, color: "#dfe6ee", density: 0.01 },
          ambient: { intensity: 0.7, color: "#dbe7ff" },
        },
      },
      {
        tool: "add_procedural",
        input: {
          type: "forest",
          id: "$snowy_pines",
          species: "snowy",
          count: 40,
          radius: 22,
          relations: [{ predicate: "near", target: ANCHOR }],
        },
      },
      {
        tool: "add_objects",
        input: {
          objects: [
            {
              id: "$snowman",
              name: "snowman",
              asset_query: "snowman",
              count: 2,
              tags: ["snowman"],
              relations: [{ predicate: "near", target: ANCHOR, distance: 3 }],
            },
            {
              id: "$sled",
              name: "sled",
              asset_query: "sled",
              tags: ["sled"],
              relations: [{ predicate: "next_to", target: "$snowman" }],
            },
          ],
        },
      },
    ],
  ),
  alien_planet: builtIn(
    "alien_planet",
    "Purple valley under a dreamy sky, glowing crystals and strange rocks",
    [
      {
        tool: "set_environment",
        input: {
          sky: "dreamy",
          timeOfDay: 16.5,
          terrain: { type: "valley", height: 14, color: "#6b4a8a" },
          fog: { enabled: true, color: "#4fd1c5", density: 0.012 },
          sun: { color: "#ffb3e6" },
          ambient: { color: "#7af0ff", intensity: 0.7 },
          postfx: { saturation: 1.4, bloom: 0.8 },
        },
      },
      {
        tool: "add_objects",
        input: {
          objects: [
            {
              id: "$crystal",
              name: "glowing crystal",
              shape: "cone",
              size: [1.2, 5, 1.2],
              count: 8,
              material: {
                color: "#7ff6ff",
                emissive: "#3ee6ff",
                emissiveIntensity: 1.6,
                roughness: 0.2,
              },
              tags: ["crystal"],
              relations: [{ predicate: "around", target: ANCHOR, distance: 6 }],
            },
            {
              id: "$orb",
              name: "floating orb",
              shape: "sphere",
              size: [2.5, 2.5, 2.5],
              material: { color: "#ff9bf2", emissive: "#ff5fd8", emissiveIntensity: 1.2 },
              tags: ["orb"],
              relations: [{ predicate: "near", target: ANCHOR, distance: 1 }],
            },
          ],
        },
      },
      {
        tool: "add_procedural",
        input: {
          type: "rocks",
          id: "$alien_rocks",
          count: 20,
          radius: 16,
          relations: [{ predicate: "near", target: ANCHOR }],
        },
      },
    ],
  ),
};
