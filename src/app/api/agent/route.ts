import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { PROFILES, type ProfileName } from "@/agent/config";
import { agentRequest } from "@/agent/request";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

/**
 * Thin, secure proxy to Claude. Holds the API key, adds the (cached) system
 * prompt and tools, rate-limits, and streams the SDK's event stream back as
 * NDJSON. The agent loop and tool execution run in the browser.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 400_000;
const HOUR = 3_600_000;

/**
 * Layered limits protect the API bill on a public deployment: bursts and a
 * daily allowance per visitor (IP), plus an hourly cap across everyone this
 * instance serves. All are per server instance (no shared store); env vars
 * tune them, and AGENT_DISABLED=1 switches the agent off entirely.
 */
const limits = [
  { limit: createRateLimiter(30, 60_000), key: clientKey, message: "slow down a little" },
  {
    limit: createRateLimiter(envNumber("AGENT_DAILY_LIMIT_PER_IP", 300), 24 * HOUR),
    key: clientKey,
    message: "that's today's allowance for this demo",
  },
  {
    limit: createRateLimiter(envNumber("AGENT_HOURLY_LIMIT", 2000), HOUR),
    key: () => "everyone",
    message: "the demo is very busy right now",
  },
];

const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.union([z.string().min(1), z.array(z.looseObject({ type: z.string() })).min(1)]),
      }),
    )
    .min(1)
    .max(2 * 3 + 1),
  /** Named model setup; only known names are accepted. */
  profile: z.enum(Object.keys(PROFILES) as [ProfileName, ...ProfileName[]]).optional(),
});

let client: Anthropic | null = null;

export async function POST(req: Request): Promise<Response> {
  if (process.env.AGENT_DISABLED === "1") {
    return errorResponse(503, "The agent is switched off on this deployment.");
  }
  for (const { limit, key, message } of limits) {
    const limited = limit(key(req));
    if (!limited.ok) {
      return errorResponse(429, `Too many commands: ${message}.`, {
        "retry-after": String(limited.retryAfterSeconds),
      });
    }
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return errorResponse(
      500,
      process.env.VERCEL
        ? "ANTHROPIC_API_KEY is not set. Add it in the Vercel project's Environment Variables and redeploy."
        : "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.",
    );
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return errorResponse(413, "Request too large.");
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, `Bad request: ${z.prettifyError(parsed.error)}`);

  client ??= new Anthropic();
  const started = Date.now();
  const stream = client.beta.messages.stream(
    agentRequest(parsed.data.messages as Anthropic.Beta.BetaMessageParam[], parsed.data.profile),
    { signal: req.signal },
  );

  try {
    // Surfaces auth / rate-limit / validation errors before we start streaming.
    await stream.withResponse();
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error(`[agent] ${err.status} ${err.message}`);
      return errorResponse(err.status ?? 502, err.message);
    }
    throw err;
  }

  stream.on("error", (err) => console.error("[agent] stream error:", err.message));
  stream.on("finalMessage", (m) => {
    const u = m.usage;
    console.log(
      `[agent] model=${m.model} stop=${m.stop_reason} ${Date.now() - started}ms ` +
        `in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} ` +
        `cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`,
    );
  });

  return new Response(stream.toReadableStream(), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function errorResponse(
  status: number,
  error: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json({ error }, { status, headers });
}
