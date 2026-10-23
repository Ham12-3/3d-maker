import type { StoredWorld, WorldRepo } from "./repo";

/**
 * Supabase over plain REST (PostgREST + Storage), so no client dependency.
 * Uses the secret (or legacy service_role) key, which bypasses RLS; the
 * `worlds` table has RLS on and no policies, so public keys can't touch it.
 */

const BUCKET = "thumbnails";
const TIMEOUT_MS = 10_000;

type Row = {
  id: string;
  title: string;
  world: StoredWorld["world"];
  thumbnail_url: string | null;
  edit_token_hash: string;
  created_at: string;
  updated_at: string;
};

export function supabaseRepo(baseUrl: string, key: string): WorldRepo {
  const base = baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = { apikey: key };
  // Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys don't.
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;

  const call = async (url: string, init: RequestInit = {}) => {
    const res = await fetch(url, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string>) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  };

  return {
    kind: "supabase",

    async get(id) {
      const res = await call(`${base}/rest/v1/worlds?id=eq.${encodeURIComponent(id)}&select=*`);
      const rows = (await res.json()) as Row[];
      const row = rows[0];
      return row
        ? {
            id: row.id,
            title: row.title,
            world: row.world,
            thumbnailUrl: row.thumbnail_url,
            editTokenHash: row.edit_token_hash,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : null;
    },

    async save(w) {
      const row: Row = {
        id: w.id,
        title: w.title,
        world: w.world,
        thumbnail_url: w.thumbnailUrl,
        edit_token_hash: w.editTokenHash,
        created_at: w.createdAt,
        updated_at: w.updatedAt,
      };
      await call(`${base}/rest/v1/worlds`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(row),
      });
    },

    async putThumbnail(id, jpeg) {
      await call(`${base}/storage/v1/object/${BUCKET}/${id}.jpg`, {
        method: "POST",
        headers: { "content-type": "image/jpeg", "x-upsert": "true", "cache-control": "60" },
        body: jpeg as BodyInit,
      });
      // The version query busts CDN caches when a world is re-shared.
      return `${base}/storage/v1/object/public/${BUCKET}/${id}.jpg?v=${Date.now()}`;
    },
  };
}
