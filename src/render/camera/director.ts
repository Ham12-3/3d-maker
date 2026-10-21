import { create } from "zustand";
import type { CameraState } from "@/scene/schema";
import { sceneStore } from "@/scene/store";
import type { CameraMove } from "./shots";

/**
 * Bridge between the agent (which asks for camera moves) and the CameraRig
 * inside the Canvas (which plays them). Also mirrors the live camera so the
 * scene summary and solver know what the user is looking at.
 */
type DirectorState = {
  move: CameraMove | null;
  /** Bumped on every request so the same move can be replayed. */
  moveId: number;
  live: CameraState;
  play: (move: CameraMove) => void;
  stop: () => void;
  setLive: (camera: CameraState) => void;
};

export const useDirector = create<DirectorState>()((set) => ({
  move: null,
  moveId: 0,
  live: sceneStore.getState().world.camera,
  play: (move) => set((s) => ({ move, moveId: s.moveId + 1 })),
  stop: () => set({ move: null }),
  setLive: (live) => set({ live }),
}));
