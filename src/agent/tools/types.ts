import type { Draft } from "immer";
import type { z } from "zod";
import type { CameraMove } from "@/render/camera/shots";
import type { CameraState, Vec3, World } from "@/scene/schema";

/**
 * Everything a tool executor may touch. Executors are plain functions over
 * this context (no React, no globals), so they run the same in the browser,
 * in tests and in headless evals.
 */
export type ToolContext = {
  getWorld: () => World;
  edit: (label: string, recipe: (draft: Draft<World>) => void) => void;
  selection: string | null;
  pointer: Vec3 | null;
  /** The live camera (what the user sees right now). */
  camera: CameraState;
  /** Seed for this turn, so placements are reproducible. */
  seed: number;
  moveCamera: (move: CameraMove) => void;
  say: (text: string) => void;
};

export type ToolOutcome =
  { ok: true; result: string; activity: string } | { ok: false; error: string };

export type AgentTool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: S;
  /** Stream this tool's input as it is generated (tools that create things). */
  eagerInputStreaming?: boolean;
  /** Short present-tense label for the activity line, e.g. "Adding objects". */
  pending: string;
  execute: (input: z.infer<S>, ctx: ToolContext) => ToolOutcome;
};

export function defineTool<S extends z.ZodType>(tool: AgentTool<S>): AgentTool<S> {
  return tool;
}

export function fail(error: string): ToolOutcome {
  return { ok: false, error };
}

export function fmt(v: Vec3): string {
  return `(${v.map((n) => Number(n.toFixed(1))).join(", ")})`;
}
