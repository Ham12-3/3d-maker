"use client";

import { canRedo, canUndo, useScene } from "@/scene/store";

/** Top left: world title and undo/redo. */
export function Toolbar() {
  const title = useScene((s) => s.world.title);
  const undoable = useScene(canUndo);
  const redoable = useScene(canRedo);
  const undoLabel = useScene((s) => s.past.at(-1)?.label);
  const redoLabel = useScene((s) => s.future.at(-1)?.label);
  const undo = useScene((s) => s.undo);
  const redo = useScene((s) => s.redo);

  return (
    <div className="glass absolute top-4 left-4 flex items-center gap-1 py-1.5 pr-1.5 pl-4">
      <span className="mr-3 text-sm font-medium tracking-tight">{title}</span>
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

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
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
