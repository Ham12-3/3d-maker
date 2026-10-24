import path from "node:path";
import type { World } from "@/scene/schema";
import { fileRepo } from "./file-repo";
import { supabaseRepo } from "./supabase-repo";

/** Server-side storage for shared worlds. Route handlers only. */

export type StoredWorld = {
  id: string;
  title: string;
  world: World;
  thumbnailUrl: string | null;
  editTokenHash: string;
  createdAt: string;
  updatedAt: string;
};

export interface WorldRepo {
  readonly kind: "supabase" | "file";
  get(id: string): Promise<StoredWorld | null>;
  /** Insert or replace the whole row. */
  save(row: StoredWorld): Promise<void>;
  /** Store a JPEG thumbnail and return its public URL. */
  putThumbnail(id: string, jpeg: Uint8Array): Promise<string>;
  /** Only the file repo serves thumbnails itself. */
  readThumbnail?(id: string): Promise<Uint8Array | null>;
}

/**
 * Supabase when configured. Otherwise worlds are saved as files in `.data/`,
 * which works for `pnpm dev` and `pnpm start` on one machine. Vercel's
 * filesystem doesn't persist, so there sharing needs Supabase (routes answer 503).
 */
export function getRepo(): WorldRepo | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return supabaseRepo(url, key);
  if (!process.env.VERCEL) return fileRepo(path.join(process.cwd(), ".data"));
  return null;
}
