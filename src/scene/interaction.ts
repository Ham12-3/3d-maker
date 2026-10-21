import { create } from "zustand";
import type { Vec3 } from "./schema";

/**
 * Transient interaction state: what the user clicked. Not part of the world,
 * not undoable. Becomes SELECTION / POINTER in the agent's scene summary.
 */
type InteractionState = {
  selectedId: string | null;
  pointer: Vec3 | null;
  select: (id: string | null) => void;
  setPointer: (point: Vec3 | null) => void;
};

export const useInteraction = create<InteractionState>()((set) => ({
  selectedId: null,
  pointer: null,
  select: (selectedId) => set({ selectedId }),
  setPointer: (pointer) => set({ pointer }),
}));
