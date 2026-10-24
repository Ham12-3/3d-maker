import { searchAllAssets, searchAssets } from "@/assets/search";
import { useAssetStatus } from "@/assets/status";
import { useDirector } from "@/render/camera/director";
import { recordAndDownload } from "@/render/camera/recording";
import { captureView } from "@/render/capture";
import { useInteraction } from "@/scene/interaction";
import { sceneStore } from "@/scene/store";
import { ROUTING, type ProfileName } from "./config";
import { useConversation } from "./conversation";
import { requestAgent, runAgentTurn } from "./loop";
import { useAgentStatus } from "./status";
import type { RecordedStep, ToolImage } from "./tools/types";

/** What the last command that built something built, for "save this as X". */
let previousTurn: { command: string; steps: RecordedStep[] } | null = null;

/** Turns with at least this many tool calls get an automatic Polish pass (when enabled). */
const AUTO_POLISH_MIN_TOOLS = 3;

type RunOptions = {
  /** performance.now() when the user released push-to-talk (voice latency). */
  speechEndedAt?: number;
  /** Images to send with the command (Polish sends the current view). */
  images?: ToolImage[];
  routing?: "routed" | ProfileName;
  /** Short label for the status line and undo history instead of the full prompt. */
  label?: string;
  polish?: boolean;
};

/**
 * Run one command through the agent, wired to the app's store, camera and
 * status line.
 */
export async function runCommand(command: string, opts: RunOptions = {}): Promise<void> {
  const text = command.trim();
  if (!text || useAgentStatus.getState().running) return;
  const turnStartedAt = performance.now();
  const shown = opts.label ?? text;

  const abort = new AbortController();
  const chat = useConversation.getState();
  const reply = chat.start(shown, {
    ...(opts.speechEndedAt !== undefined ? { voice: true } : {}),
    ...(opts.polish ? { polish: true } : {}),
  });
  useAgentStatus.setState({
    running: true,
    command: shown,
    activity: opts.polish ? "Looking at the scene" : "Thinking",
    say: null,
    error: null,
    abort,
  });
  const { selectedId, pointer } = useInteraction.getState();

  const result = await runAgentTurn(text, {
    request: requestAgent,
    store: sceneStore,
    context: {
      selection: selectedId,
      pointer,
      camera: useDirector.getState().live,
      aspect: viewAspect(),
    },
    moveCamera: (move, { record } = {}) => {
      if (!record) return useDirector.getState().play(move);
      recordAndDownload(move).catch((err: Error) =>
        useConversation.getState().note(`Recording failed: ${err.message}`),
      );
    },
    say: (say) => {
      useAgentStatus.setState({ say });
      chat.say(reply, say);
    },
    searchAssets,
    searchAllAssets,
    brokenAssets: () => useAssetStatus.getState().broken,
    previousTurn,
    captureView,
    onActivity: (activity) => {
      useAgentStatus.setState({ activity });
      chat.phase(reply, activity);
    },
    // Finished actions become the reply's steps (say is shown as its text).
    onToolResult: (name, result) => {
      if (!result.isError && name !== "say" && result.activity) chat.step(reply, result.activity);
    },
    signal: abort.signal,
    ...(opts.images ? { images: opts.images } : {}),
    ...(opts.routing ? { routing: opts.routing } : {}),
    ...(opts.label ? { label: opts.label } : {}),
  });

  if (process.env.NODE_ENV === "development") {
    console.info(
      `[agent] ${result.status} "${shown}" model=${result.model}${result.escalated ? " (escalated)" : ""} tools=${result.toolCalls} iterations=${result.iterations} ` +
        `first-visible=${result.firstVisibleMs?.toFixed(0) ?? "-"}ms first-change=${result.firstChangeMs?.toFixed(0) ?? "-"}ms total=${result.totalMs.toFixed(0)}ms`,
      result.error ?? "",
    );
  }
  chat.finish(reply, {
    status: result.status,
    ...(result.error ? { error: result.error } : {}),
    ...(result.model ? { model: result.model.replace(/^claude-/, "") } : {}),
    seconds: result.totalMs / 1000,
  });
  if (result.status === "done") {
    // A ground click is a one-shot "there": don't let it leak into the next command.
    useInteraction.getState().setPointer(null);
    if (result.recorded?.length) previousTurn = { command: shown, steps: result.recorded };
  }
  useAgentStatus.setState({
    running: false,
    abort: null,
    activity: null,
    error: result.status === "error" ? (result.error ?? "Something went wrong") : null,
    ...(opts.polish ? {} : { lastRequest: text }),
    lastTurn: {
      ...result,
      command: shown,
      ...(opts.speechEndedAt !== undefined
        ? {
            transcribeMs: turnStartedAt - opts.speechEndedAt,
            speechToFirstChangeMs:
              (result.firstVisibleMs ?? result.firstChangeMs) === undefined
                ? undefined
                : turnStartedAt -
                  opts.speechEndedAt +
                  (result.firstVisibleMs ?? result.firstChangeMs)!,
          }
        : {}),
    },
  });

  if (
    result.status === "done" &&
    !opts.polish &&
    useAgentStatus.getState().autoPolish &&
    result.toolCalls >= AUTO_POLISH_MIN_TOOLS
  ) {
    void runPolish();
  }
}

/**
 * Visual critique: send the current view and the last request to the main
 * model, which makes at most three concrete fixes. One pass per click.
 */
export async function runPolish(): Promise<void> {
  if (useAgentStatus.getState().running) return;
  const image = await captureView();
  if (!image) {
    useAgentStatus.setState({ error: "Nothing to look at yet: the scene hasn't rendered." });
    return;
  }
  const request = useAgentStatus.getState().lastRequest;
  await runCommand(polishPrompt(request), {
    images: [image],
    routing: ROUTING.main,
    label: "Polish",
    polish: true,
  });
}

export function polishPrompt(request: string | null): string {
  return [
    "POLISH PASS. The attached image is the current view of the scene.",
    request ? `The user's last request was: "${request}".` : "Judge the scene as a whole.",
    "Compare what you can see with the request and the scene summary. Look for: things floating, sunk or overlapping;",
    "badly scaled objects; odd colours; cluttered piles; empty or lopsided areas; the main subject out of view or hidden.",
    "Make at most 3 concrete improvements with tools (update_objects, add/remove, set_environment, set_camera). Don't rebuild the scene.",
    "If it already looks right, change nothing. Finish with say: what you improved, in one short sentence.",
  ].join(" ");
}

/** Width/height of the 3D frame (9:16 in Director's reel frame). */
function viewAspect(): number {
  const el = document.querySelector<HTMLElement>("[data-stage-frame]");
  const w = el?.clientWidth || window.innerWidth;
  const h = el?.clientHeight || window.innerHeight;
  return h > 0 ? w / h : 16 / 9;
}

export function cancelCommand(): void {
  useAgentStatus.getState().abort?.abort();
}
