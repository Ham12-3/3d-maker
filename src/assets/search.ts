import { searchKit } from "./catalog";
import type { AssetCandidate, AssetSearch } from "./types";

/**
 * Browser asset search, tiered: the bundled kit first (instant, offline,
 * CC0), then Poly Pizza through our server proxy. Results are memoised per
 * query for the session.
 */

const remote = new Map<string, Promise<AssetCandidate[]>>();

export const searchAssets: AssetSearch = async (query, limit = 5) => {
  const local = searchKit(query, limit);
  if (local.length > 0) return local;
  return (await searchRemote(query)).slice(0, limit);
};

/** Both tiers, bundled kit first, for the search_assets tool. */
export async function searchAllAssets(query: string, limit = 6): Promise<AssetCandidate[]> {
  const local = searchKit(query, limit);
  const online = await searchRemote(query).catch(() => []);
  return [...local, ...online].slice(0, limit);
}

function searchRemote(query: string): Promise<AssetCandidate[]> {
  const q = query.trim().toLowerCase();
  let hit = remote.get(q);
  if (!hit) {
    hit = fetch(`/api/assets/search?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((body: { results?: AssetCandidate[] }) => body.results ?? [])
      .catch(() => []);
    remote.set(q, hit);
  }
  return hit;
}
