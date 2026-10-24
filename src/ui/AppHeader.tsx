"use client";

import { useState } from "react";
import { runPolish } from "@/agent/run-command";
import { useAgentStatus } from "@/agent/status";
import { useDirector } from "@/render/camera/director";
import { canRedo, canUndo, sceneStore, useScene } from "@/scene/store";
import { Credits } from "./Credits";
import { DirectorPanel, RecordingBadge } from "./DirectorPanel";
import { useLayout } from "./layout";
import { ShareMenu } from "./ShareMenu";

type Panel = "director" | "share" | null;

/**
 * Top bar, laid out like Lovable's editor: panel toggle, logo, world name and
 * history on the left; Polish, Director, Credits and Share on the right.
 */
export function AppHeader() {
  const [panel, setPanel] = useState<Panel>(null);
  const toggle = (p: Panel) => setPanel((open) => (open === p ? null : p));
  const recording = useDirector((s) => s.recording);

  return (
    <header className="bg-shell relative z-30 flex h-12 shrink-0 items-center gap-2 px-3">
      <ChatToggle />
      <span className="brand-gradient grid size-7 shrink-0 place-items-center rounded-lg text-sm font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]">
        S
      </span>
      <WorldTitle />
      <History />

      <div className="ml-auto flex items-center gap-1.5">
        {recording && <RecordingBadge startedAt={recording.startedAt} />}
        <PolishButton />
        <HeaderButton active={panel === "director"} onClick={() => toggle("director")}>
          Director
        </HeaderButton>
        <Credits />
        <button
          type="button"
          onClick={() => toggle("share")}
          aria-expanded={panel === "share"}
          className="brand-gradient rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_2px_12px_rgb(255_77_141/0.35)] transition hover:brightness-110"
        >
          Share
        </button>
      </div>

      {panel && (
        <div className="absolute top-full right-3 mt-1">
          {panel === "director" && <DirectorPanel onClose={() => setPanel(null)} />}
          {panel === "share" && <ShareMenu onClose={() => setPanel(null)} />}
        </div>
      )}
    </header>
  );
}

function ChatToggle() {
  const open = useLayout((s) => s.chatOpen);
  const toggle = useLayout((s) => s.toggleChat);
  return (
    <IconButton
      label={open ? "Hide chat (Ctrl+B)" : "Show chat (Ctrl+B)"}
      onClick={toggle}
      pressed={open}
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </IconButton>
  );
}

/** The world's name; click to rename (one undo step). */
function WorldTitle() {
  const title = useScene((s) => s.world.title);
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Rename"
        className="min-w-0 truncate rounded-md px-1.5 py-1 text-sm font-medium text-white/90 hover:bg-white/[0.06]"
      >
        {title}
      </button>
    );
  }
  const commit = (value: string) => {
    const next = value.trim().slice(0, 120);
    if (next && next !== title) {
      sceneStore.getState().edit("Rename world", (d) => {
        d.title = next;
      });
    }
    setEditing(false);
  };
  return (
    <input
      autoFocus
      defaultValue={title}
      aria-label="World name"
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.currentTarget.value);
        if (e.key === "Escape") setEditing(false);
      }}
      className="bg-raised w-48 rounded-md border border-white/15 px-1.5 py-1 text-sm text-white focus:outline-none"
    />
  );
}

function History() {
  const undoable = useScene(canUndo);
  const redoable = useScene(canRedo);
  const undoLabel = useScene((s) => s.past.at(-1)?.label);
  const redoLabel = useScene((s) => s.future.at(-1)?.label);
  const undo = useScene((s) => s.undo);
  const redo = useScene((s) => s.redo);
  return (
    <div className="flex items-center">
      <IconButton
        label={undoLabel ? `Undo "${undoLabel}"` : "Undo"}
        disabled={!undoable}
        onClick={undo}
      >
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
      </IconButton>
      <IconButton
        label={redoLabel ? `Redo "${redoLabel}"` : "Redo"}
        disabled={!redoable}
        onClick={redo}
      >
        <path d="m15 14 5-5-5-5" />
        <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
      </IconButton>
    </div>
  );
}

function PolishButton() {
  const running = useAgentStatus((s) => s.running);
  const autoPolish = useAgentStatus((s) => s.autoPolish);
  return (
    <div className="flex items-center rounded-lg border border-white/10">
      <button
        type="button"
        disabled={running}
        onClick={() => void runPolish()}
        title="Look at the scene and fix what doesn't match the request"
        className="flex items-center gap-1.5 rounded-l-lg px-2.5 py-1.5 text-xs text-white/85 transition hover:bg-white/[0.06] disabled:opacity-30"
      >
        <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor">
          <path d="M12 2l1.8 5.6L19.5 9.5l-5.7 1.9L12 17l-1.8-5.6L4.5 9.5l5.7-1.9z" />
        </svg>
        Polish
      </button>
      <label
        className="flex cursor-pointer items-center gap-1 border-l border-white/10 px-2 py-1.5 text-[11px] text-white/55 hover:bg-white/[0.06]"
        title="Polish automatically after bigger builds"
      >
        <input
          type="checkbox"
          checked={autoPolish}
          onChange={(e) => useAgentStatus.setState({ autoPolish: e.target.checked })}
          className="accent-pink-400"
        />
        Auto
      </label>
    </div>
  );
}

export function HeaderButton({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={`rounded-lg border px-3 py-1.5 text-xs transition ${
        active
          ? "border-white/25 bg-white/[0.08] text-white"
          : "border-white/10 text-white/80 hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function IconButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg text-white/70 transition hover:bg-white/[0.06] hover:text-white disabled:pointer-events-none disabled:opacity-30"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}
