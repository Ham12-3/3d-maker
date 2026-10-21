import type Anthropic from "@anthropic-ai/sdk";
import { BetaMessageStream } from "@anthropic-ai/sdk/lib/BetaMessageStream";
import type { StoreApi } from "zustand/vanilla";
import type { CameraMove } from "@/render/camera/shots";
import type { SceneStore } from "@/scene/store";
import { MAX_ITERATIONS, MAX_TOOL_CALLS } from "./config";
import { buildSceneSummary, type SummaryContext } from "./summary";
import { executeToolCall, getTool, type ToolCallResult } from "./tools";
import type { ToolContext } from "./tools/types";

/**
 * Client-side agent loop. One command = one agent turn = one undo step.
 *
 * 1. Build context (scene summary, selection, pointer) into the user message.
 * 2. POST to /api/agent, which streams Claude's events back.
 * 3. Run each tool as soon as its block finishes streaming, so the world
 *    changes while Claude is still writing the rest of the response.
 * 4. Send tool results back and loop until Claude stops calling tools.
 */

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResultParam = Anthropic.Beta.BetaToolResultBlockParam;

export type AgentDeps = {
  /** Send messages to the proxy and return its NDJSON event stream. */
  request: (messages: MessageParam[], signal?: AbortSignal) => Promise<ReadableStream<Uint8Array>>;
  store: StoreApi<SceneStore>;
  context: SummaryContext;
  moveCamera: (move: CameraMove) => void;
  say: (text: string) => void;
  onActivity?: (text: string) => void;
  onToolResult?: (name: string, result: ToolCallResult) => void;
  signal?: AbortSignal;
  seed?: number;
  now?: () => number;
};

export type TurnResult = {
  status: "done" | "error" | "cancelled";
  error?: string;
  toolCalls: number;
  iterations: number;
  /** ms from start to the first tool that changed something, and to the end. */
  firstChangeMs?: number;
  totalMs: number;
};

export async function runAgentTurn(command: string, deps: AgentDeps): Promise<TurnResult> {
  const now = deps.now ?? (() => performance.now());
  const started = now();
  const store = deps.store;
  let toolCalls = 0;
  let iterations = 0;
  let firstChangeMs: number | undefined;

  const ctx: ToolContext = {
    getWorld: () => store.getState().world,
    edit: (label, recipe) => store.getState().edit(label, recipe),
    selection: deps.context.selection,
    pointer: deps.context.pointer,
    camera: deps.context.camera,
    seed: deps.seed ?? Math.floor(Math.random() * 2 ** 31),
    moveCamera: deps.moveCamera,
    say: deps.say,
  };

  const runTool = (block: Anthropic.Beta.BetaToolUseBlock): ToolResultParam => {
    if (toolCalls >= MAX_TOOL_CALLS) {
      return toolResult(
        block.id,
        true,
        `Tool call limit (${MAX_TOOL_CALLS}) reached for this command. Stop here.`,
      );
    }
    toolCalls++;
    const result = executeToolCall(block.name, block.input, ctx);
    if (!result.isError) {
      firstChangeMs ??= now() - started;
      if (result.activity) deps.onActivity?.(result.activity);
    }
    deps.onToolResult?.(block.name, result);
    return toolResult(block.id, result.isError, result.content);
  };

  const summary = buildSceneSummary(store.getState().world, deps.context);
  const messages: MessageParam[] = [{ role: "user", content: `${summary}\n\nCOMMAND: ${command}` }];

  store.getState().beginTransaction(command.length > 48 ? `${command.slice(0, 45)}...` : command);
  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;
      deps.onActivity?.(iterations === 1 ? "Thinking" : "Continuing");
      const body = await deps.request(messages, deps.signal);
      const stream = BetaMessageStream.fromReadableStream(body);
      const results = new Map<string, ToolResultParam>();

      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          const pending = getTool(event.content_block.name)?.pending;
          if (pending) deps.onActivity?.(pending);
        }
      });
      stream.on("contentBlock", (block) => {
        if (block.type === "tool_use") results.set(block.id, runTool(block));
      });

      const message = await stream.finalMessage();
      const toolUses = message.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      );

      if (message.stop_reason === "refusal") throw new AgentError("Claude declined this request.");
      if (message.stop_reason === "max_tokens" && toolUses.length > 0) {
        // A truncated tool input can still parse; don't keep its effects.
        throw new AgentError("The response was cut off before it finished. Try a smaller request.");
      }
      if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;
      if (iterations >= MAX_ITERATIONS) break;

      const toolResults = toolUses.map((block) => results.get(block.id) ?? runTool(block));
      // `say` is Claude's sign-off. If everything succeeded there is nothing left
      // to react to, so skip the round trip that would only return "end_turn".
      if (toolUses.some((b) => b.name === "say") && toolResults.every((r) => !r.is_error)) break;

      messages.push({ role: "assistant", content: message.content });
      messages.push({ role: "user", content: toolResults });
    }

    store.getState().commitTransaction();
    return { status: "done", toolCalls, iterations, firstChangeMs, totalMs: now() - started };
  } catch (err) {
    store.getState().rollbackTransaction();
    const cancelled = deps.signal?.aborted ?? false;
    return {
      status: cancelled ? "cancelled" : "error",
      error: cancelled ? undefined : (err as Error).message,
      toolCalls,
      iterations,
      firstChangeMs,
      totalMs: now() - started,
    };
  }
}

export class AgentError extends Error {}

function toolResult(id: string, isError: boolean, content: string): ToolResultParam {
  return { type: "tool_result", tool_use_id: id, content, ...(isError ? { is_error: true } : {}) };
}

/** Browser transport: POST to the proxy, turn JSON errors into readable messages. */
export async function requestAgent(messages: MessageParam[], signal?: AbortSignal) {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new AgentError(body?.error ?? `Agent request failed (${res.status})`);
  }
  return res.body;
}
