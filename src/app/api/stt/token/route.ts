import { z } from "zod";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";
import {
  REALTIME_CLIENT_SECRETS_URL,
  STT_MODEL,
  transcriptionSessionBody,
} from "@/voice/openai-session";

/**
 * Speech-to-text credentials. The browser streams audio straight to OpenAI,
 * so it needs a key; this hands out a short-lived client secret instead of
 * the real one.
 *   GET  -> { openai: boolean }  (is OpenAI speech configured?)
 *   POST -> { value, expires_at } (secret for one transcription session)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimit = createRateLimiter(20, 60_000);
const BodySchema = z.object({ keywords: z.array(z.string()).max(200).optional() });

export function GET(): Response {
  return Response.json({ openai: Boolean(process.env.OPENAI_API_KEY), model: STT_MODEL });
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not set; using the browser's speech recognition instead." },
      { status: 503 },
    );
  }
  const limited = rateLimit(clientKey(req));
  if (!limited.ok) return Response.json({ error: "Too many speech sessions" }, { status: 429 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  const keywords = parsed.success ? (parsed.data.keywords ?? []) : [];

  try {
    const res = await fetch(REALTIME_CLIENT_SECRETS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(transcriptionSessionBody(keywords)),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => null)) as {
      value?: string;
      expires_at?: number;
      error?: { message?: string };
    } | null;
    if (!res.ok || !body?.value) {
      const message = body?.error?.message ?? `OpenAI returned ${res.status}`;
      console.error("[stt] client secret failed:", message);
      return Response.json({ error: `Speech service: ${message}` }, { status: 502 });
    }
    return Response.json(
      { value: body.value, expires_at: body.expires_at },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[stt] client secret failed:", (err as Error).message);
    return Response.json({ error: "Speech service unavailable" }, { status: 502 });
  }
}
