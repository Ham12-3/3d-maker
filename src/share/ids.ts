import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Share ids and edit tokens. Ids are short and unguessable enough for
 * read-only links; the edit token (kept only by the browser that created the
 * world) is what allows updating it, and only its hash is stored.
 */

// 32 symbols without look-alikes (no l, o, 0, 1), so `byte & 31` is unbiased.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export const WORLD_ID_PATTERN = /^[a-z0-9]{6,16}$/;

export function newWorldId(length = 10): string {
  return [...randomBytes(length)].map((b) => ALPHABET[b & 31]).join("");
}

export function newEditToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
