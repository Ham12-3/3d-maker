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
  /** The user's last real request (not a Polish pass), for Polish to judge against. */
  lastRequest: string | null;
  /** Run a Polish pass automatically after bigger builds. */
  autoPolish: boolean;
};

export const useAgentStatus = create<AgentStatus>()(() => ({
  running: false,
  command: null,
  activity: null,
  say: null,
  error: null,
  lastTurn: null,
  abort: null,
  lastRequest: null,
  autoPolish: false,
}));
