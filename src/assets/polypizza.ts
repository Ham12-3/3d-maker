import { z } from "zod";
import { tokenize } from "./catalog";
import type { AssetCandidate } from "./types";

/**
 * Server-side Poly Pizza client (API v1.1, https://poly.pizza/docs/api/v1.1).
 * Auth is an `x-auth-token` header, required for the API and for model files
 * on static.poly.pizza, so files are proxied too and the key never reaches
 * the browser.
 */

export const POLYPIZZA_API = "https://api.poly.pizza/v1.1";
export const POLYPIZZA_FILE_HOST = "static.poly.pizza";
/** Models heavier than this hurt the 60 fps budget on integrated graphics. */
const MAX_TRIS = 60_000;

const ModelSchema = z.looseObject({
  ID: z.string(),
  Title: z.string(),
  Attribution: z.string().optional(),
  Thumbnail: z.string().optional(),
  Download: z.string(),
  "Tri Count": z.number().optional(),
  Licence: z.string().optional(),
  Animated: z.boolean().optional(),
  Category: z.string().optional(),
});
const SearchSchema = z.looseObject({ total: z.number().optional(), results: z.array(ModelSchema) });

export type PolyModel = z.infer<typeof ModelSchema>;

export function licenseOf(licence: string | undefined): AssetCandidate["license"] {
  if (!licence) return "other";
  if (/^cc0/i.test(licence)) return "CC0";
  if (/^cc[- ]?by/i.test(licence)) return "CC-BY";
  return "other";
}

export function isValidModelId(id: string): boolean {
  return /^[A-Za-z0-9_-]{4,32}$/.test(id);
}

/** Map a Poly Pizza model to a candidate, scored against the query words. */
export function toCandidate(m: PolyModel, query: string, rank: number): AssetCandidate {
  const words = tokenize(query);
  const title = new Set(tokenize(m.Title));
  const hits = words.filter((w) => title.has(w)).length;
  const license = licenseOf(m.Licence);
  return {
    source: "polypizza",
    id: m.ID,
    name: m.Title,
    url: `/api/assets/file/${m.ID}`,
    license,
    ...(m.Attribution ? { attribution: m.Attribution } : {}),
    ...(m.Thumbnail ? { thumbnail: m.Thumbnail } : {}),
    ...(m["Tri Count"] !== undefined ? { triCount: m["Tri Count"] } : {}),
    tags: tokenize(`${m.Title} ${m.Category ?? ""}`),
    // Title matches first, CC0 preferred, then the API's own ranking.
    score: hits * 2 + (license === "CC0" ? 1 : 0) - rank * 0.05,
  };
}

/** Search CC0 first, then CC-BY if CC0 alone is thin. Filters out heavy and animated models. */
export async function searchPolyPizza(
  query: string,
  apiKey: string,
  limit = 8,
): Promise<AssetCandidate[]> {
  const keyword = encodeURIComponent(query.trim().slice(0, 60));
  const fetchPage = async (license: 0 | 1) => {
    const res = await fetch(`${POLYPIZZA_API}/search/${keyword}?Limit=16&License=${license}`, {
      headers: { "x-auth-token": apiKey },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`Poly Pizza search failed (${res.status})`);
    return SearchSchema.parse(await res.json()).results;
  };

  const cc0 = await fetchPage(1);
  const models = cc0.length >= limit ? cc0 : [...cc0, ...(await fetchPage(0))];
  return models
    .filter(
      (m) => !m.Animated && (m["Tri Count"] ?? 0) <= MAX_TRIS && licenseOf(m.Licence) !== "other",
    )
    .map((m, i) => toCandidate(m, query, i))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function getPolyModel(id: string, apiKey: string): Promise<PolyModel> {
  const res = await fetch(`${POLYPIZZA_API}/model/${encodeURIComponent(id)}`, {
    headers: { "x-auth-token": apiKey },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Poly Pizza model lookup failed (${res.status})`);
  return ModelSchema.parse(await res.json());
}

/** Only ever fetch model files from Poly Pizza's own file host (no open proxy). */
export function isAllowedFileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" && u.hostname === POLYPIZZA_FILE_HOST && u.pathname.endsWith(".glb")
    );
  } catch {
    return false;
  }
}
