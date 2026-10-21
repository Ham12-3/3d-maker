import type Anthropic from "@anthropic-ai/sdk";
import { BetaMessageStream } from "@anthropic-ai/sdk/lib/BetaMessageStream";
import type { StoreApi } from "zustand/vanilla";
import { computeShot, fogVisibility, type CameraMove } from "@/render/camera/shots";
import type { SceneStore } from "@/scene/store";
import type { AssetSearch } from "@/assets/types";
import { MAX_ITERATIONS, MAX_TOOL_CALLS } from "./config";
import { formatJudge, judgeWorld, type JudgeReport } from "./judge";
import { focusFor } from "./tools/common";
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
  searchAssets: AssetSearch;
  searchAllAssets: AssetSearch;
  /** Asset URLs the renderer failed to load (for the judge). */
  brokenAssets?: () => Record<string, string>;
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
  /** What the judge fixed itself, and what it still had to report. */
  judge?: { fixed: string[]; hard: string[] };
};

export async function runAgentTurn(command: string, deps: AgentDeps): Promise<TurnResult> {
  const now = deps.now ?? (() => performance.now());
  const started = now();
  const store = deps.store;
  let toolCalls = 0;
  let iterations = 0;
  let firstChangeMs: number | undefined;
  let bigBuild = false;
  let cameraMoved = false;

  const ctx: ToolContext = {
    getWorld: () => store.getState().world,
    edit: (label, recipe) => store.getState().edit(label, recipe),
    selection: deps.context.selection,
    pointer: deps.context.pointer,
    camera: deps.context.camera,
    seed: deps.seed ?? Math.floor(Math.random() * 2 ** 31),
    moveCamera: deps.moveCamera,
    say: deps.say,
    searchAssets: deps.searchAssets,
    searchAllAssets: deps.searchAllAssets,
    candidates: new Map(),
  };

  const runTool = async (block: Anthropic.Beta.BetaToolUseBlock): Promise<ToolResultParam> => {
    if (toolCalls >= MAX_TOOL_CALLS) {
      return toolResult(
        block.id,
        true,
        `Tool call limit (${MAX_TOOL_CALLS}) reached for this command. Stop here.`,
      );
    }
    toolCalls++;
    const result = await executeToolCall(block.name, block.input, ctx);
    if (!result.isError) {
      firstChangeMs ??= now() - started;
      if (result.activity) deps.onActivity?.(result.activity);
      if (block.name === "set_camera") cameraMoved = true;
      const type = (block.input as { type?: string } | null)?.type;
      if (block.name === "add_procedural" && (type === "lake" || type === "forest"))
        bigBuild = true;
    }
    deps.onToolResult?.(block.name, result);
    return toolResult(block.id, result.isError, result.content);
  };

  const summary = buildSceneSummary(store.getState().world, deps.context);
  const messages: MessageParam[] = [{ role: "user", content: `${summary}\n\nCOMMAND: ${command}` }];
  let judgeSent = false;
  let judge: TurnResult["judge"];

  store.getState().beginTransaction(command.length > 48 ? `${command.slice(0, 45)}...` : command);
  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;
      deps.onActivity?.(iterations === 1 ? "Thinking" : "Continuing");
      const body = await deps.request(messages, deps.signal);
      const stream = BetaMessageStream.fromReadableStream(body);
      // Tools run one after another, each as soon as its block finishes streaming.
      let queue: Promise<unknown> = Promise.resolve();
      const results = new Map<string, Promise<ToolResultParam>>();
      const enqueue = (block: Anthropic.Beta.BetaToolUseBlock) => {
        const result = queue.then(() => runTool(block));
        queue = result;
        results.set(block.id, result);
        return result;
      };

      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          const pending = getTool(event.content_block.name)?.pending;
          if (pending) deps.onActivity?.(pending);
        }
      });
      stream.on("contentBlock", (block) => {
        if (block.type === "tool_use") enqueue(block);
      });

      const message = await stream.finalMessage().finally(() => queue.catch(() => {}));
      const toolUses = message.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      );
      const toolResults = await Promise.all(toolUses.map((b) => results.get(b.id) ?? enqueue(b)));

      if (message.stop_reason === "refusal") throw new AgentError("Claude declined this request.");
      if (message.stop_reason === "max_tokens" && toolUses.length > 0) {
        // A truncated tool input can still parse; don't keep its effects.
        throw new AgentError("The response was cut off before it finished. Try a smaller request.");
      }

      // `say` is Claude's sign-off: with everything succeeded there is nothing to
      // react to, so skip the round trip that would only return "end_turn".
      const signedOff =
        toolUses.some((b) => b.name === "say") && toolResults.every((r) => !r.is_error);
      const finished = message.stop_reason !== "tool_use" || toolUses.length === 0 || signedOff;

      if (finished || iterations >= MAX_ITERATIONS) {
        const report = runJudge(store, deps);
        judge = mergeJudge(judge, report);
        // One chance for Claude to fix what the judge couldn't.
        if (report.hard.length > 0 && !judgeSent && iterations < MAX_ITERATIONS) {
          judgeSent = true;
          messages.push({ role: "assistant", content: message.content });
          messages.push({
            role: "user",
            content: [...toolResults, { type: "text", text: formatJudge(report) }],
          });
          continue;
        }
        break;
      }

      messages.push({ role: "assistant", content: message.content });
      messages.push({ role: "user", content: toolResults });
    }

    store.getState().commitTransaction();
    // A new lake or forest can swallow the view (the camera may end up inside
    // the trees). Unless Claude chose a shot itself, pull back to frame it.
    if (bigBuild && !cameraMoved) {
      const focus = focusFor("scene", ctx);
      if (typeof focus !== "string")
        deps.moveCamera(
          computeShot(
            "establishing",
            focus,
            ctx.camera,
            undefined,
            fogVisibility(ctx.getWorld().environment.fog),
          ),
        );
    }
    return {
      status: "done",
      toolCalls,
      iterations,
      firstChangeMs,
      totalMs: now() - started,
      judge,
    };
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

/** Judge the nodes this turn touched, apply its fixes inside the turn's transaction. */
function runJudge(store: StoreApi<SceneStore>, deps: AgentDeps): JudgeReport {
  const state = store.getState();
  const touched = new Set<string>();
  for (const patch of state.transaction?.patches ?? []) {
    if (patch.path[0] === "nodes" && typeof patch.path[1] === "string") touched.add(patch.path[1]);
  }
  const report = judgeWorld(state.world, touched, deps.brokenAssets?.() ?? {});
  if (report.fixes.size > 0) {
    state.edit("Judge fixes", (draft) => {
      for (const [id, position] of report.fixes) {
        const node = draft.nodes[id];
        if (node) node.transform.position = position;
      }
    });
  }
  return report;
}

function mergeJudge(
  prev: TurnResult["judge"],
  report: JudgeReport,
): NonNullable<TurnResult["judge"]> {
  return {
    fixed: [...(prev?.fixed ?? []), ...report.fixed.map((i) => i.detail)],
    hard: report.hard.map((i) => i.detail),
  };
}

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
