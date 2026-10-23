import { z } from "zod";
import { createRateLimiter } from "@/lib/rate-limit";
import { MAX_SAVE_BYTES, SaveBodySchema, type SaveBody } from "@/share/save";

/** Shared request parsing and rate limit for the save routes. */

export const saveRateLimit = createRateLimiter(10, 60_000);

export async function readSaveBody(req: Request): Promise<SaveBody | Response> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_SAVE_BYTES) {
    return saveError(413, "World too large to share.");
  }
  const text = await req.text();
  if (text.length > MAX_SAVE_BYTES) return saveError(413, "World too large to share.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return saveError(400, "Bad JSON");
  }
  const parsed = SaveBodySchema.safeParse(json);
  if (!parsed.success) return saveError(400, `Bad world: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function saveError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}
