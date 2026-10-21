import { searchPolyPizza } from "@/assets/polypizza";
import type { AssetCandidate } from "@/assets/types";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";
import { TtlCache } from "@/lib/ttl-cache";

/**
 * Poly Pizza search proxy: keeps the API key on the server and caches results
 * for a day (same query, same answer, and it spares the API).
 * GET /api/assets/search?q=wooden+cabin
 */

export const runtime = "nodejs";

const cache = new TtlCache<AssetCandidate[]>(24 * 60 * 60 * 1000);
const rateLimit = createRateLimiter(60, 60_000);

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  if (q.length < 2 || q.length > 60)
    return Response.json({ error: "q must be 2-60 characters" }, { status: 400 });

  const apiKey = process.env.POLYPIZZA_API_KEY;
  if (!apiKey) return Response.json({ results: [], disabled: true });

  const cached = cache.get(q);
  if (cached) return Response.json({ results: cached, cached: true });

  const limited = rateLimit(clientKey(req));
  if (!limited.ok) return Response.json({ error: "Too many searches" }, { status: 429 });

  try {
    const results = await searchPolyPizza(q, apiKey);
    cache.set(q, results);
    return Response.json(
      { results },
      { headers: { "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (err) {
    console.error("[assets] search failed:", (err as Error).message);
    return Response.json({ results: [], error: "Asset search is unavailable" }, { status: 502 });
  }
}
