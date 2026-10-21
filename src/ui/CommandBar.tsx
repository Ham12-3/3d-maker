"use client";

import { useEffect, useRef, useState } from "react";
import { cancelCommand, runCommand } from "@/agent/run-command";
import { useAgentStatus } from "@/agent/status";
import { useVoiceStatus } from "@/voice/status";
import { voice } from "@/voice/useVoice";

const SAY_VISIBLE_MS = 7000;

/**
 * Bottom centre: hold Space (or the mic) to talk, or type. Shows the live
 * transcript while you speak, then what the agent is doing and what it said.
 */
export function CommandBar() {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { running, activity, say, error } = useAgentStatus();
  const { provider, state: voiceState, partial, error: voiceError } = useVoiceStatus();
  const voiceAvailable = provider === "openai" || provider === "webspeech";
  const speaking = voiceState !== "idle";

  // "/" focuses the bar from anywhere; Escape cancels a running command.
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

  useEffect(() => {
    if (!say) return;
    const timer = setTimeout(() => useAgentStatus.setState({ say: null }), SAY_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [say]);

  const submit = () => {
    if (!text.trim() || running) return;
    void runCommand(text);
    setText("");
  };

  const overlay = speaking
    ? voiceState === "connecting"
      ? "Connecting mic"
      : partial || (voiceState === "listening" ? "Listening" : "Transcribing")
    : running
      ? (activity ?? "Thinking")
      : null;
  const shownError = voiceError ?? (!running ? error : null);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-2 px-4">
      {say && (
        <div className="glass animate-[fadeUp_0.3s_ease-out] px-4 py-2 text-sm text-white/95">
          {say}
        </div>
      )}
      {shownError && (
        <div className="glass border-red-400/30 px-4 py-2 text-sm text-red-200">{shownError}</div>
      )}

      <form
        className="glass pointer-events-auto flex w-full max-w-xl items-center gap-3 py-2 pr-2 pl-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {voiceAvailable ? (
          <MicButton active={speaking} disabled={running} />
        ) : (
          <span className="pl-2">
            <StatusDot running={running} />
          </span>
        )}
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              overlay
                ? ""
                : voiceAvailable
                  ? "Hold Space to talk, or type… e.g. make it sunset with fog"
                  : "Describe a change… e.g. make it sunset with fog"
            }
            aria-label="Command"
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent py-1.5 text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
          {overlay && !text && (
            <span
              className={`pointer-events-none absolute inset-y-0 left-0 flex min-w-0 items-center truncate text-sm ${
                speaking && partial ? "text-white" : "text-white/70"
              }`}
            >
              {overlay}
              {!(speaking && partial) && <span className="ml-0.5 animate-pulse">…</span>}
            </span>
          )}
        </div>
        {running ? (
          <button
            type="button"
            onClick={cancelCommand}
            className="rounded-lg px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10"
          >
            Cancel
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim()}
            className="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-neutral-900 transition hover:bg-white disabled:opacity-30"
          >
            Build
          </button>
        )}
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
      className="relative grid size-9 shrink-0 touch-none place-items-center rounded-full text-white/80 transition hover:bg-white/10 disabled:opacity-30"
    >
      <span
        ref={ring}
        className={`absolute inset-1 rounded-full transition-colors ${active ? "animate-pulse bg-rose-500/40" : "bg-transparent"}`}
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

function StatusDot({ running }: { running: boolean }) {
  return (
    <span className="relative flex size-2.5 shrink-0">
      {running && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-75" />
      )}
      <span
        className={`relative inline-flex size-2.5 rounded-full ${running ? "bg-sky-400" : "bg-white/30"}`}
      />
    </span>
  );
}
