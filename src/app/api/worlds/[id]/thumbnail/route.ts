import { WORLD_ID_PATTERN } from "@/share/ids";
import { getRepo } from "@/share/repo";

/** GET /api/worlds/:id/thumbnail: only used by the development file repo. */

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!WORLD_ID_PATTERN.test(id)) return new Response("Bad world id", { status: 400 });
  const repo = getRepo();
  if (!repo?.readThumbnail) return new Response("Not found", { status: 404 });
  const jpeg = await repo.readThumbnail(id);
  if (!jpeg) return new Response("Not found", { status: 404 });
  return new Response(jpeg as BodyInit, {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=60" },
  });
}
