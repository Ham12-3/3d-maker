import type { Draft } from "immer";
import type { z } from "zod";
import type { AssetCandidate, AssetSearch } from "@/assets/types";
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
  /** Tiered asset search (bundled kit, then Poly Pizza). Mocked in tests/evals. */
  searchAssets: AssetSearch;
  /** Wider search for the search_assets tool (both tiers). */
  searchAllAssets: AssetSearch;
  /** Candidates seen this turn, keyed "source:id", so add_objects can use asset_id. */
  candidates: Map<string, AssetCandidate>;
  /** Successful building steps of this turn, for save_macro next time. */
  recorder?: RecordedStep[];
  /** What the previous command built (save_macro saves this). */
  previousTurn?: { command: string; steps: RecordedStep[] } | null;
  /** Renders the current view; null when there is no renderer (tests, evals). */
  captureView?: () => Promise<ToolImage | null>;
};

export type RecordedStep = {
  tool: string;
  input: unknown;
  /** Node and region ids the step created, in creation order. */
  created: string[];
  regions: string[];
};

export type ToolImage = {
  mediaType: "image/jpeg" | "image/png";
  data: string;
  width: number;
  height: number;
};

export type ToolOutcome =
  | { ok: true; result: string; activity: string; images?: ToolImage[] }
  | { ok: false; error: string };

export type AgentTool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: S;
  /** Stream this tool's input as it is generated (tools that create things). */
  eagerInputStreaming?: boolean;
  /** Short present-tense label for the activity line, e.g. "Adding objects". */
  pending: string;
  execute: (input: z.infer<S>, ctx: ToolContext) => ToolOutcome | Promise<ToolOutcome>;
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
