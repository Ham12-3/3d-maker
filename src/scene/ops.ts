import type { Draft } from "immer";
import type { Environment, SceneNode, Vec3, World } from "./schema";

/**
 * Small, reusable edit recipes for `store.edit(label, recipe)`.
 * Agent tool executors (Phase 1) build on these too.
 */

type Recipe = (draft: Draft<World>) => void;

/** Top-level environment fields, with nested objects (fog, sun, ...) merged one level deep. */
export type EnvironmentPatch = {
  [K in keyof Environment]?: Environment[K] extends object
    ? Partial<Environment[K]>
    : Environment[K];
};

export function patchEnvironment(patch: EnvironmentPatch): Recipe {
  return (draft) => {
    const env = draft.environment as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const current = env[key];
      if (isPlainObject(value) && isPlainObject(current)) {
        Object.assign(current, value);
      } else {
        env[key] = value;
      }
    }
  };
}

export function addNode(node: SceneNode): Recipe {
  return (draft) => {
    if (draft.nodes[node.id]) throw new Error(`Node "${node.id}" already exists`);
    draft.nodes[node.id] = node;
  };
}

/** Removes nodes and anything parented to them. */
export function removeNodes(ids: string[]): Recipe {
  return (draft) => {
    const doomed = new Set(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of Object.values(draft.nodes)) {
        if (node.parentId && doomed.has(node.parentId) && !doomed.has(node.id)) {
          doomed.add(node.id);
          grew = true;
        }
      }
    }
    for (const id of doomed) delete draft.nodes[id];
  };
}

export function setPosition(id: string, position: Vec3): Recipe {
  return (draft) => {
    const node = draft.nodes[id];
    if (!node) throw new Error(`Node "${id}" does not exist`);
    node.transform.position = position;
  };
}

/** Next readable id for a base name: "box" -> "box_3" if box_1 and box_2 exist. */
export function nextNodeId(world: World, base: string): string {
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(?=[0-9])/, "n_") || "node";
  let n = 1;
  while (world.nodes[`${slug}_${n}`]) n++;
  return `${slug}_${n}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
