import type { AssetRef, Vec3 } from "@/scene/schema";

/** One search hit from any asset source. */
export type AssetCandidate = {
  source: AssetRef["source"];
  id: string;
  name: string;
  url: string;
  license: AssetRef["license"];
  attribution?: string;
  /** Real-world size in metres when known up front (bundled kit). */
  size?: Vec3;
  thumbnail?: string;
  triCount?: number;
  tags: string[];
  /** Relevance to the query, higher is better. */
  score: number;
};

export type AssetSearch = (query: string, limit?: number) => Promise<AssetCandidate[]>;

export function toAssetRef(c: AssetCandidate): AssetRef {
  return {
    source: c.source,
    id: c.id,
    url: c.url,
    license: c.license,
    ...(c.attribution ? { attribution: c.attribution } : {}),
  };
}
