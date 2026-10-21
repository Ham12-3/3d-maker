import type { World } from "@/scene/schema";

/**
 * Recognition hints: app vocabulary plus names in the current scene, so
 * "put a lantern by the cabin" isn't heard as "put a lantern by the cab in".
 */

const VOCABULARY = [
  "cabin",
  "fog",
  "misty",
  "fireflies",
  "lantern",
  "pine",
  "forest",
  "lake",
  "sunset",
  "sunrise",
  "flyover",
  "orbit",
  "boulder",
  "campfire",
  "meadow",
  "spooky",
  "cosy",
];

export const MAX_KEYWORDS = 60;
const MAX_KEYWORD_LENGTH = 40;

/** Keywords must be one line without <, > or line breaks, or the session is rejected. */
export function sanitizeKeywords(words: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const w of words) {
    if (typeof w !== "string") continue;
    const clean = w
      .replace(/[<>\r\n\t]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_KEYWORD_LENGTH);
    if (clean.length >= 2) out.add(clean.toLowerCase());
    if (out.size >= MAX_KEYWORDS) break;
  }
  return [...out];
}

export function keywordsFor(world: World): string[] {
  const names = Object.values(world.nodes).flatMap((n) => [n.name, ...n.tags]);
  const regions = Object.keys(world.regions).map((id) => id.replace(/_/g, " "));
  return sanitizeKeywords([...VOCABULARY, ...names, ...regions]);
}
