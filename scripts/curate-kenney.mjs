/**
 * Copies a curated set of Kenney CC0 models into public/assets/kenney and
 * writes manifest.json with real-world sizes, so the solver knows a model's
 * footprint before it loads.
 *
 * Usage: node scripts/curate-kenney.mjs <dir-with-extracted-kits>
 * where the dir holds nature/x, holiday/x and survival/x (each an extracted
 * Kenney zip). Re-run after changing the CURATED list.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const KITS = {
  nature: { dir: "nature/x/Models/GLTF format", name: "Nature Kit" },
  holiday: { dir: "holiday/x/Models/GLB format", name: "Holiday Kit", texture: true },
  survival: { dir: "survival/x/Models/GLB format", name: "Survival Kit", texture: true },
};

// [kit, file, id, name, tags, target] — target is the real-world height in
// metres, or { long: n } to size by the longest side instead.
const CURATED = [
  [
    "nature",
    "tree_pineTallA_detailed",
    "pine_tall_a",
    "tall pine tree",
    ["tree", "pine", "conifer", "evergreen", "forest"],
    13,
  ],
  [
    "nature",
    "tree_pineTallB_detailed",
    "pine_tall_b",
    "tall pine tree",
    ["tree", "pine", "conifer", "evergreen", "forest"],
    11,
  ],
  [
    "nature",
    "tree_pineDefaultA",
    "pine_a",
    "pine tree",
    ["tree", "pine", "conifer", "evergreen", "forest"],
    8,
  ],
  [
    "nature",
    "tree_pineRoundA",
    "pine_round",
    "round pine tree",
    ["tree", "pine", "conifer", "forest"],
    7,
  ],
  [
    "nature",
    "tree_pineSmallA",
    "pine_small",
    "small pine tree",
    ["tree", "pine", "sapling", "forest"],
    4,
  ],
  ["nature", "tree_default", "tree_leafy", "leafy tree", ["tree", "deciduous", "forest"], 7],
  ["nature", "tree_oak", "oak", "oak tree", ["tree", "oak", "deciduous", "forest"], 9],
  ["nature", "tree_detailed", "tree_round", "round tree", ["tree", "deciduous", "forest"], 8],
  ["nature", "tree_fat", "tree_bushy", "bushy tree", ["tree", "deciduous"], 6],
  [
    "nature",
    "tree_default_fall",
    "tree_autumn",
    "autumn tree",
    ["tree", "autumn", "fall", "deciduous"],
    7,
  ],
  ["nature", "tree_oak_fall", "oak_autumn", "autumn oak", ["tree", "oak", "autumn", "fall"], 9],
  [
    "nature",
    "tree_thin_dark",
    "tree_dark",
    "dark thin tree",
    ["tree", "dark", "spooky", "dead"],
    7,
  ],
  ["nature", "tree_palmTall", "palm_tall", "palm tree", ["tree", "palm", "tropical", "beach"], 10],
  [
    "nature",
    "tree_palmBend",
    "palm_bend",
    "leaning palm tree",
    ["tree", "palm", "tropical", "beach"],
    8,
  ],
  ["nature", "cactus_tall", "cactus", "cactus", ["cactus", "desert", "plant"], 3],
  ["nature", "rock_largeA", "rock_large_a", "large rock", ["rock", "boulder", "stone"], 1.8],
  ["nature", "rock_largeC", "rock_large_c", "large rock", ["rock", "boulder", "stone"], 1.5],
  ["nature", "rock_tallA", "rock_tall", "tall rock", ["rock", "stone", "cliff"], 3],
  ["nature", "rock_smallA", "rock_small_a", "small rock", ["rock", "stone", "pebble"], 0.5],
  ["nature", "rock_smallC", "rock_small_c", "small rock", ["rock", "stone", "pebble"], 0.4],
  ["nature", "rock_smallFlatA", "rock_flat", "flat rock", ["rock", "stone"], 0.3],
  ["nature", "stump_round", "stump", "tree stump", ["stump", "wood", "log"], 0.5],
  ["nature", "log", "log", "log", ["log", "wood", "timber"], { long: 2.5 }],
  ["nature", "log_stack", "log_pile", "log pile", ["log", "wood", "firewood", "pile"], 1],
  [
    "nature",
    "mushroom_redGroup",
    "mushrooms_red",
    "red mushrooms",
    ["mushroom", "fungus", "forest"],
    0.3,
  ],
  ["nature", "mushroom_tanTall", "mushroom_tan", "tall mushroom", ["mushroom", "fungus"], 0.4],
  [
    "nature",
    "plant_bushLarge",
    "bush_large",
    "large bush",
    ["bush", "shrub", "plant", "hedge"],
    1.5,
  ],
  ["nature", "plant_bush", "bush", "bush", ["bush", "shrub", "plant"], 0.8],
  ["nature", "flower_redA", "flower_red", "red flowers", ["flower", "red", "plant"], 0.4],
  [
    "nature",
    "flower_yellowA",
    "flower_yellow",
    "yellow flowers",
    ["flower", "yellow", "plant"],
    0.4,
  ],
  [
    "nature",
    "flower_purpleA",
    "flower_purple",
    "purple flowers",
    ["flower", "purple", "plant"],
    0.4,
  ],
  ["nature", "grass_large", "grass_tuft", "grass tuft", ["grass", "plant"], 0.5],
  [
    "nature",
    "lily_large",
    "lily_pad",
    "lily pad",
    ["lily", "water", "lake", "pond", "plant"],
    { long: 1 },
  ],
  [
    "nature",
    "campfire_stones",
    "campfire",
    "campfire",
    ["campfire", "fire", "camp"],
    { long: 1.2 },
  ],
  ["nature", "tent_detailedOpen", "tent", "tent", ["tent", "camp", "camping"], 2.2],
  ["nature", "canoe", "canoe", "canoe", ["canoe", "boat", "water", "kayak"], { long: 4.5 }],
  ["nature", "fence_simple", "fence", "wooden fence", ["fence", "wood", "barrier"], 1],
  ["nature", "fence_gate", "fence_gate", "fence gate", ["fence", "gate", "wood"], 1.2],
  ["nature", "bridge_wood", "bridge", "wooden bridge", ["bridge", "wood", "river"], { long: 6 }],
  ["nature", "sign", "sign", "wooden sign", ["sign", "signpost", "wood"], 1.5],
  [
    "nature",
    "statue_obelisk",
    "obelisk",
    "stone obelisk",
    ["obelisk", "statue", "monument", "stone"],
    4,
  ],
  [
    "nature",
    "path_stone",
    "stepping_stones",
    "stepping stones",
    ["path", "stone", "stepping"],
    { long: 1.5 },
  ],
  [
    "holiday",
    "lantern",
    "lantern_post",
    "lantern post",
    ["lantern", "lamp", "light", "street lamp"],
    2.2,
  ],
  ["holiday", "bench", "bench", "bench", ["bench", "seat", "wood", "park"], 0.8],
  ["holiday", "snowman", "snowman", "snowman", ["snowman", "snow", "winter"], 1.6],
  [
    "holiday",
    "tree-snow-a",
    "pine_snowy",
    "snowy pine tree",
    ["tree", "pine", "snow", "winter", "forest"],
    8,
  ],
  ["holiday", "sled", "sled", "sled", ["sled", "sledge", "snow", "winter"], { long: 1.2 }],
  ["survival", "barrel", "barrel", "barrel", ["barrel", "wood", "container"], 1],
  ["survival", "chest", "chest", "treasure chest", ["chest", "treasure", "box"], 0.6],
  [
    "survival",
    "campfire-pit",
    "campfire_pit",
    "campfire pit",
    ["campfire", "fire", "fire pit"],
    0.5,
  ],
  ["survival", "signpost", "signpost", "signpost", ["signpost", "sign", "wood"], 2],
  ["survival", "tent-canvas", "tent_canvas", "canvas tent", ["tent", "camp", "canvas"], 2.2],
  ["survival", "bucket", "bucket", "bucket", ["bucket", "container"], 0.4],
  ["survival", "workbench", "workbench", "workbench", ["workbench", "table", "workshop"], 1],
  ["survival", "box-large", "crate", "wooden crate", ["crate", "box", "wood", "container"], 1],
  ["survival", "tree-log", "fallen_log", "fallen log", ["log", "wood", "fallen tree"], { long: 3 }],
];

function glbBounds(file) {
  const b = readFileSync(file);
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], a.min[i]);
        max[i] = Math.max(max[i], a.max[i]);
      }
    }
  }
  return max.map((v, i) => v - min[i]);
}

const src = process.argv[2];
if (!src) throw new Error("usage: node scripts/curate-kenney.mjs <dir-with-extracted-kits>");
const out = join(process.cwd(), "public/assets/kenney");
const round = (n) => Math.round(n * 100) / 100;
const entries = [];

for (const [kit, file, id, name, tags, target] of CURATED) {
  const from = join(src, KITS[kit].dir, `${file}.glb`);
  if (!existsSync(from)) throw new Error(`missing ${from}`);
  mkdirSync(join(out, kit), { recursive: true });
  copyFileSync(from, join(out, kit, `${file}.glb`));

  const native = glbBounds(from);
  const k =
    typeof target === "number" ? target / native[1] : target.long / Math.max(native[0], native[2]);
  entries.push({
    id,
    name,
    tags,
    url: `/assets/kenney/${kit}/${file}.glb`,
    size: native.map((v) => round(v * k)),
    kit: KITS[kit].name,
  });
}

for (const [kit, cfg] of Object.entries(KITS)) {
  if (!cfg.texture) continue;
  mkdirSync(join(out, kit, "Textures"), { recursive: true });
  copyFileSync(
    join(src, cfg.dir, "Textures/colormap.png"),
    join(out, kit, "Textures/colormap.png"),
  );
}
copyFileSync(join(src, "nature/x/License.txt"), join(out, "License.txt"));

writeFileSync(
  join(out, "manifest.json"),
  JSON.stringify({ license: "CC0", author: "Kenney (www.kenney.nl)", models: entries }, null, 2) +
    "\n",
);
console.log(`curated ${entries.length} models into ${out}`);
