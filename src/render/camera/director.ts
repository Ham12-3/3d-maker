import { create } from "zustand";
import type { CameraState } from "@/scene/schema";
import { sceneStore } from "@/scene/store";
import type { CameraMove } from "./shots";

/**
 * Bridge between the agent (which asks for camera moves) and the CameraRig
 * inside the Canvas (which plays them). Also mirrors the live camera so the
 * scene summary and solver know what the user is looking at, and holds
 * Director mode's frame (full screen or a 9:16 reel) and recording state.
 */

export type Frame = "full" | "vertical";
export type RecordingState = {
  /** Output video size in pixels. */
  width: number;
  height: number;
  /** Pixel ratio that makes the 9:16 canvas render at the output height. */
  dpr: number;
  startedAt: number;
};

type DirectorState = {
  move: CameraMove | null;
  /** Bumped on every request so the same move can be replayed. */
  moveId: number;
  live: CameraState;
  frame: Frame;
  /** Set while a video is being recorded (the canvas renders at this size). */
  recording: RecordingState | null;
  play: (move: CameraMove) => void;
  stop: () => void;
  setLive: (camera: CameraState) => void;
  setFrame: (frame: Frame) => void;
  setRecording: (recording: RecordingState | null) => void;
};

export const useDirector = create<DirectorState>()((set) => ({
  move: null,
  moveId: 0,
  live: sceneStore.getState().world.camera,
  frame: "full",
  recording: null,
  play: (move) => set((s) => ({ move, moveId: s.moveId + 1 })),
  stop: () => set({ move: null }),
  setLive: (live) => set({ live }),
  setFrame: (frame) => set({ frame }),
  setRecording: (recording) => set({ recording }),
}));
