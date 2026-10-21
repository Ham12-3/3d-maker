import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from "immer";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { loadDefaultWorld } from "./defaults";
import type { World } from "./schema";

enablePatches();

/**
 * World store with undo/redo built on Immer patches.
 *
 * Every change goes through `edit(label, recipe)`. Outside a transaction each
 * edit is one undo step. Between `beginTransaction` and `commitTransaction`
 * edits apply live (so the scene updates while an agent streams) but are
 * merged into a single undo step when committed.
 */

export const HISTORY_LIMIT = 100;

export type HistoryEntry = {
  label: string;
  patches: Patch[];
  /** Already in the order they must be applied to undo the entry. */
  inversePatches: Patch[];
};

export type SceneState = {
  world: World;
  past: HistoryEntry[];
  future: HistoryEntry[];
  transaction: HistoryEntry | null;
};

export type SceneActions = {
  edit: (label: string, recipe: (draft: Draft<World>) => void) => void;
  beginTransaction: (label: string) => void;
  commitTransaction: () => void;
  rollbackTransaction: () => void;
  undo: () => void;
  redo: () => void;
  /** Swap in a whole world (e.g. loading a saved one). Clears history. */
  replaceWorld: (world: World) => void;
};

export type SceneStore = SceneState & SceneActions;

export function createSceneStore(initialWorld: World): StoreApi<SceneStore> {
  return createStore<SceneStore>()((set, get) => ({
    world: initialWorld,
    past: [],
    future: [],
    transaction: null,

    edit(label, recipe) {
      const { world, transaction, past } = get();
      const [next, patches, inversePatches] = produceWithPatches(world, recipe);
      if (patches.length === 0) return;

      if (transaction) {
        set({
          world: next,
          transaction: {
            label: transaction.label,
            patches: [...transaction.patches, ...patches],
            // Later edits must be undone first.
            inversePatches: [...inversePatches, ...transaction.inversePatches],
          },
        });
        return;
      }

      set({
        world: next,
        past: pushLimited(past, { label, patches, inversePatches }),
        future: [],
      });
    },

    beginTransaction(label) {
      if (get().transaction) {
        throw new Error(`Transaction "${get().transaction?.label}" is already open`);
      }
      set({ transaction: { label, patches: [], inversePatches: [] } });
    },

    commitTransaction() {
      const { transaction, past } = get();
      if (!transaction) return;
      if (transaction.patches.length === 0) {
        set({ transaction: null });
        return;
      }
      set({ transaction: null, past: pushLimited(past, transaction), future: [] });
    },

    rollbackTransaction() {
      const { transaction, world } = get();
      if (!transaction) return;
      set({ transaction: null, world: applyPatches(world, transaction.inversePatches) });
    },

    undo() {
      const { past, future, world, transaction } = get();
      const entry = past.at(-1);
      if (!entry || transaction) return;
      set({
        world: applyPatches(world, entry.inversePatches),
        past: past.slice(0, -1),
        future: [...future, entry],
      });
    },

    redo() {
      const { past, future, world, transaction } = get();
      const entry = future.at(-1);
      if (!entry || transaction) return;
      set({
        world: applyPatches(world, entry.patches),
        past: pushLimited(past, entry),
        future: future.slice(0, -1),
      });
    },

    replaceWorld(world) {
      set({ world, past: [], future: [], transaction: null });
    },
  }));
}

function pushLimited(stack: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const next = [...stack, entry];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

/** The app's store instance. Tests should use `createSceneStore` instead. */
export const sceneStore = createSceneStore(loadDefaultWorld());

export function useScene<T>(selector: (state: SceneStore) => T): T {
  return useStore(sceneStore, selector);
}

export const canUndo = (s: SceneState) => s.past.length > 0 && s.transaction === null;
export const canRedo = (s: SceneState) => s.future.length > 0 && s.transaction === null;
