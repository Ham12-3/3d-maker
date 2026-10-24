import { WorldSchema, type World } from "@/scene/schema";

/**
 * Database-free sharing: the whole world, deflated and base64url-encoded,
 * travels in the link's #fragment (never sent to the server). Used when the
 * server has no storage, e.g. a deployment without Supabase.
 */

/** Longer links get unwieldy in chat apps; bigger worlds should use Export JSON. */
export const MAX_LINK_CHARS = 60_000;
export const HASH_KEY = "world=";

export async function encodeWorld(world: World): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(world));
  const packed = await pipe(json, new CompressionStream("deflate-raw"));
  return toBase64Url(packed);
}

export async function decodeWorld(encoded: string): Promise<World> {
  const packed = fromBase64Url(encoded);
  const json = await pipe(packed, new DecompressionStream("deflate-raw"));
  return WorldSchema.parse(JSON.parse(new TextDecoder().decode(json)));
}

/** The encoded world in a URL hash like "#world=...", or null. */
export function worldFromHash(hash: string): string | null {
  const h = hash.replace(/^#/, "");
  return h.startsWith(HASH_KEY) ? h.slice(HASH_KEY.length) : null;
}

async function pipe(bytes: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
