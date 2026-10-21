"use client";

import { useEffect } from "react";
import { useInteraction } from "@/scene/interaction";
import { removeNodes } from "@/scene/ops";
import { sceneStore } from "@/scene/store";

/** Global keys: Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z or Ctrl+Y redo, Delete removes selection. */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const store = sceneStore.getState();

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        store.redo();
      } else if (key === "delete" || key === "backspace") {
        const { selectedId, select } = useInteraction.getState();
        if (!selectedId) return;
        store.edit(`Remove ${selectedId}`, removeNodes([selectedId]));
        select(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "TEXTAREA" ||
    (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range")
  );
}
