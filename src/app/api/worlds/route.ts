import { clientKey } from "@/lib/rate-limit";
import { getRepo } from "@/share/repo";
import { createWorld } from "@/share/save";
import { readSaveBody, saveError, saveRateLimit } from "./body";

/**
 * POST /api/worlds  { world, thumbnail? } -> { id, editToken, url }
 * Saves a world for a read-only share link. Keep the editToken to update it.
 * GET /api/worlds -> { available } whether this server can store worlds
 * (without storage the browser packs the world into the link instead).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ available: getRepo() !== null });
}

export async function POST(req: Request): Promise<Response> {
  const limited = saveRateLimit(clientKey(req));
  if (!limited.ok) return saveError(429, "Too many saves, try again in a minute.");
  const repo = getRepo();
  if (!repo) return saveError(503, "Sharing is not configured (Supabase keys missing).");

  const body = await readSaveBody(req);
  if (body instanceof Response) return body;
  try {
    const result = await createWorld(repo, body);
    if (!result.ok) return saveError(result.status, result.error);
    return Response.json({ ...result, url: `/w/${result.id}` }, { status: 201 });
  } catch (err) {
    console.error("[worlds] save failed:", (err as Error).message);
    return saveError(502, "Could not save the world.");
  }
}
