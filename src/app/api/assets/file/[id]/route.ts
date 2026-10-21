import { getPolyModel, isAllowedFileUrl, isValidModelId } from "@/assets/polypizza";
import { TtlCache } from "@/lib/ttl-cache";

/**
 * Serves a Poly Pizza GLB by model id. The file host needs the API key, so
 * the browser fetches from here. Files are immutable per id: cached in memory
 * on this instance and by the CDN/browser for a year.
 * GET /api/assets/file/52s3JpUSjmX
 */

export const runtime = "nodejs";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const files = new TtlCache<ArrayBuffer>(6 * 60 * 60 * 1000, 60);

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  if (!isValidModelId(id)) return new Response("Bad model id", { status: 400 });
  const apiKey = process.env.POLYPIZZA_API_KEY;
  if (!apiKey) return new Response("Poly Pizza is not configured", { status: 503 });

  let body = files.get(id);
  if (!body) {
    try {
      const model = await getPolyModel(id, apiKey);
      if (!isAllowedFileUrl(model.Download))
        return new Response("Unexpected file host", { status: 502 });
      const res = await fetch(model.Download, {
        headers: { "x-auth-token": apiKey },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return new Response(`Upstream ${res.status}`, { status: 502 });
      if (Number(res.headers.get("content-length") ?? 0) > MAX_FILE_BYTES) {
        return new Response("Model too large", { status: 413 });
      }
      body = await res.arrayBuffer();
      if (body.byteLength > MAX_FILE_BYTES) return new Response("Model too large", { status: 413 });
      files.set(id, body);
    } catch (err) {
      console.error(`[assets] file ${id} failed:`, (err as Error).message);
      return new Response("Model unavailable", { status: 502 });
    }
  }

  return new Response(body, {
    headers: {
      "content-type": "model/gltf-binary",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
