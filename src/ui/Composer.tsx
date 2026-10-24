"use client";

import { useEffect, useRef, useState } from "react";
import { cancelCommand, runCommand } from "@/agent/run-command";
import { useAgentStatus } from "@/agent/status";
import { useVoiceStatus } from "@/voice/status";
import { voice } from "@/voice/useVoice";

/**
 * The prompt box at the bottom of the chat panel. Type and press Enter
 * (Shift+Enter for a new line), or hold Space / the mic to talk; the live
 * transcript shows here while you speak.
 */
export function Composer() {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const running = useAgentStatus((s) => s.running);
  const activity = useAgentStatus((s) => s.activity);
  const { provider, state: voiceState, partial, error: voiceError } = useVoiceStatus();
  const voiceAvailable = provider === "openai" || provider === "webspeech";
  const speaking = voiceState !== "idle";

  // "/" focuses the box from anywhere; Escape cancels a running command.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape" && useAgentStatus.getState().running) {
        cancelCommand();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Grow with the text, up to a few lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const submit = () => {
    if (!text.trim() || running) return;
    void runCommand(text);
    setText("");
  };

  const live = speaking
    ? voiceState === "connecting"
      ? "Connecting mic…"
      : partial || (voiceState === "listening" ? "Listening…" : "Transcribing…")
    : null;

  return (
    <div className="space-y-2">
      {voiceError && <div className="px-1 text-xs text-red-300">{voiceError}</div>}
      <form
        className="bg-raised rounded-2xl border border-white/10 p-2 shadow-[0_8px_30px_rgb(0_0_0/0.25)] transition focus-within:border-white/25"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative">
          <textarea
            ref={inputRef}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              live
                ? ""
                : voiceAvailable
                  ? "Ask Speakworld to build… or hold Space to talk"
                  : "Ask Speakworld to build…"
            }
            aria-label="Command"
            autoComplete="off"
            spellCheck={false}
            className="block w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-white placeholder:text-white/35 focus:outline-none"
          />
          {live && !text && (
            <span
              className={`pointer-events-none absolute inset-x-2 top-1.5 truncate text-sm ${partial ? "text-white" : "text-white/60"}`}
            >
              {live}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 pt-1">
          {voiceAvailable && <MicButton active={speaking} disabled={running} />}
          <span className="min-w-0 flex-1 truncate text-[11px] text-white/40">
            {running ? (activity ?? "Thinking…") : voiceAvailable ? "Hold Space to talk" : ""}
          </span>
          {running ? (
            <button
              type="button"
              onClick={cancelCommand}
              aria-label="Stop"
              title="Stop (Esc)"
              className="grid size-8 place-items-center rounded-full bg-white text-neutral-900 transition hover:bg-white/85"
            >
              <span className="size-2.5 rounded-[2px] bg-neutral-900" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!text.trim()}
              aria-label="Build"
              title="Build (Enter)"
              className="grid size-8 place-items-center rounded-full bg-white text-neutral-900 transition hover:bg-white/85 disabled:bg-white/15 disabled:text-white/40"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Hold to talk. The ring breathes with the mic level while listening. */
function MicButton({ active, disabled }: { active: boolean; disabled: boolean }) {
  const ring = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const tick = () => {
      const level = voice.level();
      if (ring.current) ring.current.style.transform = `scale(${1 + level * 0.8})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return (
    <button
      type="button"
      aria-label="Hold to talk"
      title="Hold to talk (or hold Space)"
      disabled={disabled}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        voice.press();
      }}
      onPointerUp={() => voice.release()}
      onPointerCancel={() => voice.release()}
      className="relative grid size-8 shrink-0 touch-none place-items-center rounded-full border border-white/10 text-white/75 transition hover:bg-white/10 disabled:opacity-30"
    >
      <span
        ref={ring}
        className={`absolute inset-0.5 rounded-full transition-colors ${active ? "animate-pulse bg-rose-500/40" : "bg-transparent"}`}
      />
      <svg
        viewBox="0 0 24 24"
        className="relative size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      >
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </button>
  );
}
