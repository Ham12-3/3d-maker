import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AGENT_EFFORT, AGENT_MAX_TOKENS, AGENT_MODEL } from "@/agent/config";
import { SYSTEM_PROMPT } from "@/agent/system-prompt";
import { toolDefinitions } from "@/agent/tools";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

/**
 * Thin, secure proxy to Claude. Holds the API key, adds the (cached) system
 * prompt and tools, rate-limits, and streams the SDK's event stream back as
 * NDJSON. The agent loop and tool execution run in the browser.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 400_000;
const rateLimit = createRateLimiter(30, 60_000);
// Built once: identical bytes every request keeps the prompt cache warm.
const TOOLS = toolDefinitions();

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
});

let client: Anthropic | null = null;

export async function POST(req: Request): Promise<Response> {
  const limited = rateLimit(clientKey(req));
  if (!limited.ok) {
    return errorResponse(429, "Too many commands, slow down a little.", {
      "retry-after": String(limited.retryAfterSeconds),
    });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return errorResponse(
      500,
      "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.",
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
    {
      model: AGENT_MODEL,
      max_tokens: AGENT_MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages: parsed.data.messages as Anthropic.Beta.BetaMessageParam[],
      output_config: { effort: AGENT_EFFORT },
      // Re-run on another model server-side if a safety classifier declines.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    },
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

function errorResponse(
  status: number,
  error: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json({ error }, { status, headers });
}
