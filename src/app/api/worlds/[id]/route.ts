import { clientKey } from "@/lib/rate-limit";
import { WORLD_ID_PATTERN } from "@/share/ids";
import { getRepo } from "@/share/repo";
import { updateWorld } from "@/share/save";
import { readSaveBody, saveError, saveRateLimit } from "../body";

/**
 * GET /api/worlds/:id -> { id, title, world, thumbnailUrl }
 * PUT /api/worlds/:id (header x-edit-token) { world, thumbnail? } -> { id }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  if (!WORLD_ID_PATTERN.test(id)) return saveError(400, "Bad world id");
  const repo = getRepo();
  if (!repo) return saveError(503, "Sharing is not configured.");
  try {
    const row = await repo.get(id);
    if (!row) return saveError(404, "World not found");
    const { title, world, thumbnailUrl, updatedAt } = row;
    return Response.json(
      { id, title, world, thumbnailUrl, updatedAt },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[worlds] load failed:", (err as Error).message);
    return saveError(502, "Could not load the world.");
  }
}

export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  if (!WORLD_ID_PATTERN.test(id)) return saveError(400, "Bad world id");
  const limited = saveRateLimit(clientKey(req));
  if (!limited.ok) return saveError(429, "Too many saves, try again in a minute.");
  const token = req.headers.get("x-edit-token");
  if (!token) return saveError(401, "Missing edit token");
  const repo = getRepo();
  if (!repo) return saveError(503, "Sharing is not configured.");

  const body = await readSaveBody(req);
  if (body instanceof Response) return body;
  try {
    const result = await updateWorld(repo, id, token, body);
    if (!result.ok) return saveError(result.status, result.error);
    return Response.json({ ...result, url: `/w/${id}` });
  } catch (err) {
    console.error("[worlds] update failed:", (err as Error).message);
    return saveError(502, "Could not save the world.");
  }
}
