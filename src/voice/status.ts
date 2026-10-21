import { create } from "zustand";
import type { VoiceState } from "./controller";
import type { TranscriberKind } from "./transcriber";

/** What the command bar shows about voice: engine, state, live transcript. */
type VoiceStatus = {
  /** null until we know, "none" when no engine is available (typing only). */
  provider: TranscriberKind | "none" | null;
  state: VoiceState;
  partial: string;
  error: string | null;
};

export const useVoiceStatus = create<VoiceStatus>()(() => ({
  provider: null,
  state: "idle",
  partial: "",
  error: null,
}));
