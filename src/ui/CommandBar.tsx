"use client";

import { useEffect, useRef, useState } from "react";
import { cancelCommand, runCommand } from "@/agent/run-command";
import { useAgentStatus } from "@/agent/status";

const SAY_VISIBLE_MS = 7000;

/** Bottom centre: type a command, see what the agent is doing and what it said. */
export function CommandBar() {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { running, activity, say, error } = useAgentStatus();

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

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-2 px-4">
      {say && (
        <div className="glass animate-[fadeUp_0.3s_ease-out] px-4 py-2 text-sm text-white/95">
          {say}
        </div>
      )}
      {error && !running && (
        <div className="glass border-red-400/30 px-4 py-2 text-sm text-red-200">{error}</div>
      )}

      <form
        className="glass pointer-events-auto flex w-full max-w-xl items-center gap-3 py-2 pr-2 pl-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <StatusDot running={running} />
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={running ? "" : "Describe a change… e.g. make it sunset with fog"}
            aria-label="Command"
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent py-1.5 text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
          {running && !text && (
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-sm text-white/70">
              {activity ?? "Thinking"}
              <span className="ml-0.5 animate-pulse">…</span>
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
