import { create } from "zustand";
import type { TurnResult } from "./loop";

/** What the command bar shows: is the agent working, what is it doing, what did it say. */
type AgentStatus = {
  running: boolean;
  command: string | null;
  activity: string | null;
  say: string | null;
  error: string | null;
  lastTurn:
    | (TurnResult & {
        command: string;
        /** Voice only: key release to transcript ready, and to first visible change. */
        transcribeMs?: number;
        speechToFirstChangeMs?: number;
      })
    | null;
  abort: AbortController | null;
};

export const useAgentStatus = create<AgentStatus>()(() => ({
  running: false,
  command: null,
  activity: null,
  say: null,
  error: null,
  lastTurn: null,
  abort: null,
}));
