"use client";

import { useEffect } from "react";
import { runCommand } from "@/agent/run-command";
import { useAgentStatus } from "@/agent/status";
import { sceneStore } from "@/scene/store";
import { isTyping } from "@/ui/useShortcuts";
import { createPushToTalk, type PushToTalk } from "./controller";
import { keywordsFor } from "./keywords";
import { OpenAIStreamingTranscriber } from "./openai";
import { useVoiceStatus } from "./status";
import type { Transcriber } from "./transcriber";
import { WebSpeechTranscriber, webSpeechSupported } from "./webspeech";

/**
 * Voice wiring for the app: picks an engine (OpenAI when the server has a
 * key, else the browser's recognition, else typing only), binds hold-Space
 * push-to-talk, and sends each final transcript through the agent.
 */

let ptt: PushToTalk | null = null;
let transcriber: Transcriber | null = null;

/** For the mic button and the level meter. */
export const voice = {
  press: () => ptt?.press(),
  release: () => ptt?.release(),
  level: () => transcriber?.level?.() ?? 0,
};

const keywords = () => keywordsFor(sceneStore.getState().world);

function attach(t: Transcriber, onConnectFailure: () => void): void {
  transcriber?.dispose();
  transcriber = t;
  ptt = createPushToTalk({
    transcriber: t,
    canStart: () => !useAgentStatus.getState().running,
    onCommand: (text, speechEndedAt) => {
      useVoiceStatus.setState({ partial: text });
      void runCommand(text, { speechEndedAt });
    },
    onState: (state, partial) => {
      useVoiceStatus.setState(
        state === "connecting" ? { state, partial, error: null } : { state, partial },
      );
    },
    onError: (message) => {
      useVoiceStatus.setState({ error: message });
      if (useVoiceStatus.getState().state === "connecting") onConnectFailure();
    },
  });
  useVoiceStatus.setState({ provider: t.kind });
}

function attachWebSpeechOrNothing(): void {
  if (webSpeechSupported()) attach(new WebSpeechTranscriber(), () => {});
  else {
    transcriber?.dispose();
    transcriber = null;
    ptt = null;
    useVoiceStatus.setState({ provider: "none" });
  }
}

export function useVoice(): void {
  useEffect(() => {
    let disposed = false;

    void fetch("/api/stt/token")
      .then((r) => (r.ok ? (r.json() as Promise<{ openai?: boolean }>) : { openai: false }))
      .catch(() => ({ openai: false }))
      .then(({ openai }) => {
        if (disposed) return;
        if (openai) {
          attach(new OpenAIStreamingTranscriber(keywords), () => {
            // OpenAI couldn't connect (bad key, network): keep voice working anyway.
            if (!webSpeechSupported()) return;
            attachWebSpeechOrNothing();
            useVoiceStatus.setState({
              error: "OpenAI speech unavailable, switched to browser speech recognition.",
            });
          });
        } else {
          attachWebSpeechOrNothing();
        }
      });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      e.preventDefault();
      if (!e.repeat) voice.press();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      e.preventDefault();
      voice.release();
    };
    // Letting go of Space in another window shouldn't leave the mic open.
    const onBlur = () => voice.release();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      disposed = true;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      transcriber?.dispose();
      transcriber = null;
      ptt = null;
    };
  }, []);
}
