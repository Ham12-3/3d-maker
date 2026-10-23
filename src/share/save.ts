import { z } from "zod";
import { WorldSchema } from "@/scene/schema";
import { hashToken, newEditToken, newWorldId, tokenMatches } from "./ids";
import type { StoredWorld, WorldRepo } from "./repo";

/** Create and update shared worlds. Pure over a repo, so tests use the file repo. */

export const MAX_SAVE_BYTES = 3_000_000;
const MAX_THUMBNAIL_BYTES = 1_000_000;

export const SaveBodySchema = z.object({
  world: WorldSchema,
  /** Base64 JPEG (no data: prefix). */
  thumbnail: z
    .string()
    .max(Math.ceil((MAX_THUMBNAIL_BYTES * 4) / 3))
    .optional(),
});
export type SaveBody = z.infer<typeof SaveBodySchema>;

export type SaveResult =
  | { ok: true; id: string; editToken?: string; thumbnailUrl: string | null }
  | { ok: false; status: number; error: string };

export async function createWorld(repo: WorldRepo, body: SaveBody): Promise<SaveResult> {
  const id = newWorldId();
  const editToken = newEditToken();
  const now = new Date().toISOString();
  const thumbnailUrl = await storeThumbnail(repo, id, body.thumbnail);
  if (thumbnailUrl instanceof Error) return { ok: false, status: 400, error: thumbnailUrl.message };
  await repo.save({
    id,
    title: titleOf(body),
    world: body.world,
    thumbnailUrl,
    editTokenHash: hashToken(editToken),
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, id, editToken, thumbnailUrl };
}

export async function updateWorld(
  repo: WorldRepo,
  id: string,
  editToken: string,
  body: SaveBody,
): Promise<SaveResult> {
  const existing = await repo.get(id);
  if (!existing) return { ok: false, status: 404, error: "World not found" };
  if (!tokenMatches(editToken, existing.editTokenHash)) {
    return { ok: false, status: 403, error: "This link belongs to someone else" };
  }
  const stored = await storeThumbnail(repo, id, body.thumbnail);
  if (stored instanceof Error) return { ok: false, status: 400, error: stored.message };
  const row: StoredWorld = {
    ...existing,
    title: titleOf(body),
    world: body.world,
    thumbnailUrl: stored ?? existing.thumbnailUrl,
    updatedAt: new Date().toISOString(),
  };
  await repo.save(row);
  return { ok: true, id, thumbnailUrl: row.thumbnailUrl };
}

function titleOf(body: SaveBody): string {
  return body.world.title.trim().slice(0, 120) || "Untitled world";
}

async function storeThumbnail(
  repo: WorldRepo,
  id: string,
  base64: string | undefined,
): Promise<string | null | Error> {
  if (!base64) return null;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_THUMBNAIL_BYTES) return new Error("Thumbnail too large");
  // JPEG magic number: anything else is refused.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return new Error("Thumbnail must be a JPEG");
  }
  return repo.putThumbnail(id, new Uint8Array(bytes));
}
