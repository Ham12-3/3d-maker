"use client";

import { useEffect, useRef } from "react";
import { useConversation, type AgentMessage, type ChatMessage } from "@/agent/conversation";
import { runCommand } from "@/agent/run-command";
import { useAgentStatus } from "@/agent/status";
import { Composer } from "./Composer";

const SUGGESTIONS = [
  "A cosy village by a lake at sunset",
  "Add a red and white lighthouse",
  "Make it a winter wonderland",
  "Slowly fly over the scene",
];

/**
 * Left panel, as in Lovable: the conversation (your requests, and what the
 * agent did and said for each), with the prompt box underneath.
 */
export function ChatPanel() {
  const messages = useConversation((s) => s.messages);
  const end = useRef<HTMLDivElement>(null);

  // Follow the newest message, and the steps of the one being worked on.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <aside className="bg-shell flex h-full w-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-5 pb-4">
            {messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="px-3 pt-1 pb-3">
        <Composer />
      </div>
    </aside>
  );
}

function EmptyState() {
  const running = useAgentStatus((s) => s.running);
  return (
    <div className="flex h-full flex-col justify-end gap-4 pb-4">
      <div>
        <div className="text-lg font-semibold tracking-tight text-white">What should we build?</div>
        <p className="mt-1 text-sm leading-relaxed text-white/55">
          Describe a scene or an object and it appears in the preview. Hold Space to say it instead.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={running}
            onClick={() => void runCommand(s)}
            className="bg-panel rounded-xl border border-white/10 px-3 py-2 text-left text-sm text-white/80 transition hover:border-white/25 hover:text-white disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.08] px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap text-white">
          {message.polish ? (
            <span className="flex items-center gap-1.5">
              <Sparkle /> Polish the scene
            </span>
          ) : (
            message.text
          )}
          {message.voice && <span className="ml-1.5 text-[10px] text-white/40">spoken</span>}
        </div>
      </div>
    );
  }
  return <AgentReply message={message} />;
}

function AgentReply({ message }: { message: AgentMessage }) {
  const working = message.status === "working";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-white/45">
        <span className="brand-gradient size-4 rounded-[5px]" />
        <span className="font-medium text-white/70">Speakworld</span>
        {!working && message.seconds !== undefined && (
          <span>
            · {message.seconds.toFixed(1)} s{message.model ? ` · ${message.model}` : ""}
          </span>
        )}
      </div>
      {(message.steps.length > 0 || working) && (
        <ul className="bg-panel space-y-1.5 rounded-xl border border-white/[0.07] px-3 py-2.5">
          {message.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] text-white/75">
              <Check />
              <span>{step}</span>
            </li>
          ))}
          {working && (
            <li className="flex items-start gap-2 text-[13px] text-white">
              <Spinner />
              <span>{message.live ?? "Thinking"}…</span>
            </li>
          )}
        </ul>
      )}
      {message.text && <p className="text-sm leading-relaxed text-white/90">{message.text}</p>}
      {message.status === "cancelled" && <p className="text-sm text-white/45">Stopped.</p>}
      {message.error && (
        <p className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {message.error}
        </p>
      )}
    </div>
  );
}

function Check() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mt-0.5 size-3.5 shrink-0 text-emerald-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

function Spinner() {
  return (
    <span className="mt-0.5 size-3.5 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-white" />
  );
}

function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor">
      <path d="M12 2l1.8 5.6L19.5 9.5l-5.7 1.9L12 17l-1.8-5.6L4.5 9.5l5.7-1.9z" />
    </svg>
  );
}
