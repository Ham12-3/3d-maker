import { useDirector } from "@/render/camera/director";
import { useInteraction } from "@/scene/interaction";
import { sceneStore } from "@/scene/store";
import { requestAgent, runAgentTurn } from "./loop";
import { useAgentStatus } from "./status";

/** Run one command through the agent, wired to the app's store, camera and status line. */
export async function runCommand(command: string): Promise<void> {
  const text = command.trim();
  if (!text || useAgentStatus.getState().running) return;

  const abort = new AbortController();
  useAgentStatus.setState({
    running: true,
    command: text,
    activity: "Thinking",
    say: null,
    error: null,
    abort,
  });
  const { selectedId, pointer } = useInteraction.getState();

  const result = await runAgentTurn(text, {
    request: requestAgent,
    store: sceneStore,
    context: { selection: selectedId, pointer, camera: useDirector.getState().live },
    moveCamera: (move) => useDirector.getState().play(move),
    say: (say) => useAgentStatus.setState({ say }),
    onActivity: (activity) => useAgentStatus.setState({ activity }),
    signal: abort.signal,
  });

  if (process.env.NODE_ENV === "development") {
    console.info(
      `[agent] ${result.status} "${text}" tools=${result.toolCalls} iterations=${result.iterations} ` +
        `first-change=${result.firstChangeMs?.toFixed(0) ?? "-"}ms total=${result.totalMs.toFixed(0)}ms`,
      result.error ?? "",
    );
  }
  // A ground click is a one-shot "there": don't let it leak into the next command.
  if (result.status === "done") useInteraction.getState().setPointer(null);
  useAgentStatus.setState({
    running: false,
    abort: null,
    activity: null,
    error: result.status === "error" ? (result.error ?? "Something went wrong") : null,
    lastTurn: { ...result, command: text },
  });
}

export function cancelCommand(): void {
  useAgentStatus.getState().abort?.abort();
}
