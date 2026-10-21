import manifest from "../../public/assets/kenney/manifest.json";
import type { Vec3 } from "@/scene/schema";
import type { AssetCandidate } from "./types";

/**
 * The bundled Kenney CC0 kit (public/assets/kenney, built by
 * scripts/curate-kenney.mjs) and a small keyword search over it.
 */

export type KitModel = (typeof manifest.models)[number];

export const KENNEY_MODELS: readonly KitModel[] = manifest.models;

const byId = new Map(KENNEY_MODELS.map((m) => [m.id, m]));

export function getKitModel(id: string): KitModel | undefined {
  return byId.get(id);
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "with",
  "and",
  "some",
  "small",
  "big",
  "large",
  "little",
  "tall",
  "old",
  "new",
  "nice",
]);

/** Query word -> words to also look for. */
const SYNONYMS: Record<string, string[]> = {
  lamp: ["lantern"],
  lamppost: ["lantern"],
  boulder: ["rock"],
  stone: ["rock"],
  conifer: ["pine"],
  fir: ["pine"],
  spruce: ["pine"],
  boat: ["canoe"],
  kayak: ["canoe"],
  fire: ["campfire"],
  shrub: ["bush"],
  wooden: ["wood"],
  firewood: ["log"],
  timber: ["log"],
  seat: ["bench"],
  plant: ["bush", "flower"],
};

/** Lowercase, split, drop stop words, crude singular. */
export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/**
 * Search the bundled kit. A model must match the query's head noun (its last
 * word, or a synonym of it) so "wooden cabin" never resolves to a wooden fence;
 * the other words only boost the score.
 */
export function searchKit(query: string, limit = 5): AssetCandidate[] {
  const words = tokenize(query);
  const head = words.at(-1);
  if (!head) return [];

  const expand = (w: string) => [w, ...(SYNONYMS[w] ?? [])];
  const scored: AssetCandidate[] = [];
  for (const m of KENNEY_MODELS) {
    const haystack = new Set([...m.tags, ...tokenize(m.name), ...m.id.split("_")]);
    const matches = (w: string) => expand(w).some((x) => haystack.has(x));
    if (!matches(head)) continue;
    const score = 2 + words.slice(0, -1).filter(matches).length;
    scored.push({
      source: "kenney",
      id: m.id,
      name: m.name,
      url: m.url,
      license: "CC0",
      size: m.size as Vec3,
      tags: m.tags,
      score,
    });
  }
  // Stable: higher score first, then manifest order.
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
