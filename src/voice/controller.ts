import type { Transcriber } from "./transcriber";

/**
 * Push-to-talk state machine, independent of React and of the engine:
 *
 *   idle --press--> connecting --started--> listening --release--> transcribing --final--> idle
 *
 * - A release while still connecting stops as soon as the engine is ready.
 * - A tap shorter than MIN_HOLD_MS (an accidental Space) is discarded.
 * - Presses while busy are ignored.
 */

export type VoiceState = "idle" | "connecting" | "listening" | "transcribing";

export const MIN_HOLD_MS = 250;

export type PushToTalkOptions = {
  transcriber: Transcriber;
  /** Called with the final transcript and when the user stopped speaking. */
  onCommand: (text: string, speechEndedAt: number) => void;
  onState: (state: VoiceState, partial: string) => void;
  onError: (message: string) => void;
  /** Return false to refuse a press (e.g. the agent is still busy). */
  canStart?: () => boolean;
  now?: () => number;
};

export type PushToTalk = {
  press(): void;
  release(): void;
  readonly state: VoiceState;
};

export function createPushToTalk(opts: PushToTalkOptions): PushToTalk {
  const now = opts.now ?? (() => performance.now());
  const t = opts.transcriber;
  let state: VoiceState = "idle";
  let pressedAt = 0;
  let releasedAt = 0;
  let releasedEarly = false;
  let discard = false;
  let partial = "";

  const set = (next: VoiceState) => {
    state = next;
    opts.onState(state, partial);
  };

  const finishTurn = () => {
    releasedAt = now();
    discard = releasedAt - pressedAt < MIN_HOLD_MS;
    set("transcribing");
    t.stop().catch((err: Error) => {
      opts.onError(err.message);
      set("idle");
    });
  };

  t.onPartial((text) => {
    if (state === "idle") return;
    partial = text;
    opts.onState(state, partial);
  });

  t.onFinal((text) => {
    if (state !== "transcribing") return;
    const command = text.trim();
    const wasDiscarded = discard;
    partial = "";
    set("idle");
    if (command && !wasDiscarded) opts.onCommand(command, releasedAt);
  });

  t.onError((message) => opts.onError(message));

  return {
    get state() {
      return state;
    },
    press() {
      if (state !== "idle" || (opts.canStart && !opts.canStart())) return;
      pressedAt = now();
      releasedEarly = false;
      partial = "";
      set("connecting");
      t.start().then(
        () => {
          if (state !== "connecting") return;
          if (releasedEarly) finishTurn();
          else set("listening");
        },
        (err: Error) => {
          opts.onError(err.message);
          set("idle");
        },
      );
    },
    release() {
      if (state === "connecting") releasedEarly = true;
      else if (state === "listening") finishTurn();
    },
  };
}
