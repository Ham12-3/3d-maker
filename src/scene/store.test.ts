import { describe, expect, it } from "vitest";
import { loadDefaultWorld } from "./defaults";
import { addNode, nextNodeId, patchEnvironment, removeNodes, setPosition } from "./ops";
import type { SceneNode } from "./schema";
import { HISTORY_LIMIT, canRedo, canUndo, createSceneStore } from "./store";

function makeStore() {
  return createSceneStore(loadDefaultWorld());
}

function box(id: string, parentId?: string): SceneNode {
  return {
    id,
    name: id,
    kind: "primitive",
    primitive: "box",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    relations: [],
    tags: [],
    createdBy: "user",
    ...(parentId ? { parentId } : {}),
  };
}

describe("scene store", () => {
  it("applies an edit and undoes/redoes it", () => {
    const store = makeStore();
    const before = store.getState().world;

    store.getState().edit("Night", patchEnvironment({ timeOfDay: 22, stars: true }));
    expect(store.getState().world.environment.timeOfDay).toBe(22);
    expect(store.getState().past).toHaveLength(1);

    store.getState().undo();
    expect(store.getState().world).toEqual(before);
    expect(canUndo(store.getState())).toBe(false);
    expect(canRedo(store.getState())).toBe(true);

    store.getState().redo();
    expect(store.getState().world.environment.stars).toBe(true);
    expect(store.getState().future).toHaveLength(0);
  });

  it("merges nested environment fields instead of replacing them", () => {
    const store = makeStore();
    const fogColor = store.getState().world.environment.fog.color;
    store.getState().edit("Fog", patchEnvironment({ fog: { enabled: true } }));
    expect(store.getState().world.environment.fog).toMatchObject({
      enabled: true,
      color: fogColor,
    });
  });

  it("does not record edits that change nothing", () => {
    const store = makeStore();
    const t = store.getState().world.environment.timeOfDay;
    store.getState().edit("No-op", patchEnvironment({ timeOfDay: t }));
    expect(store.getState().past).toHaveLength(0);
  });

  it("clears the redo stack on a new edit", () => {
    const store = makeStore();
    store.getState().edit("A", patchEnvironment({ timeOfDay: 8 }));
    store.getState().undo();
    store.getState().edit("B", patchEnvironment({ timeOfDay: 9 }));
    expect(store.getState().future).toHaveLength(0);
    expect(canRedo(store.getState())).toBe(false);
  });

  it("groups a transaction into one undo step", () => {
    const store = makeStore();
    const before = store.getState().world;

    store.getState().beginTransaction("Agent turn");
    store.getState().edit("env", patchEnvironment({ timeOfDay: 18.5, sky: "sunset" }));
    store.getState().edit("add", addNode(box("box_9")));
    store.getState().edit("move", setPosition("box_9", [4, 0, 2]));
    store.getState().edit("remove", removeNodes(["sphere_1"]));

    // Edits are visible live, before commit.
    expect(store.getState().world.nodes.box_9?.transform.position).toEqual([4, 0, 2]);
    expect(store.getState().past).toHaveLength(0);
    expect(canUndo(store.getState())).toBe(false);

    store.getState().commitTransaction();
    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().past[0]?.label).toBe("Agent turn");

    store.getState().undo();
    expect(store.getState().world).toEqual(before);

    store.getState().redo();
    const world = store.getState().world;
    expect(world.environment.sky).toBe("sunset");
    expect(world.nodes.box_9?.transform.position).toEqual([4, 0, 2]);
    expect(world.nodes.sphere_1).toBeUndefined();
  });

  it("rolls back a transaction without touching history", () => {
    const store = makeStore();
    store.getState().edit("Before", patchEnvironment({ timeOfDay: 10 }));
    const before = store.getState().world;

    store.getState().beginTransaction("Failed turn");
    store.getState().edit("add", addNode(box("box_9")));
    store.getState().edit("env", patchEnvironment({ timeOfDay: 3 }));
    store.getState().rollbackTransaction();

    expect(store.getState().world).toEqual(before);
    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().transaction).toBeNull();
  });

  it("commits an empty transaction without adding history", () => {
    const store = makeStore();
    store.getState().beginTransaction("Nothing");
    store.getState().commitTransaction();
    expect(store.getState().past).toHaveLength(0);
  });

  it("refuses to nest transactions and to undo mid-transaction", () => {
    const store = makeStore();
    store.getState().edit("A", patchEnvironment({ timeOfDay: 8 }));
    store.getState().beginTransaction("Outer");
    expect(() => store.getState().beginTransaction("Inner")).toThrow(/already open/);

    store.getState().undo();
    expect(store.getState().world.environment.timeOfDay).toBe(8);
  });

  it("caps history length", () => {
    const store = makeStore();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      store.getState().edit(`t${i}`, patchEnvironment({ timeOfDay: (i % 23) + 0.5 }));
    }
    expect(store.getState().past).toHaveLength(HISTORY_LIMIT);
    expect(store.getState().past[0]?.label).toBe("t10");
  });
});

describe("ops", () => {
  it("removes children with their parent", () => {
    const store = makeStore();
    store.getState().edit("add", addNode(box("table_1")));
    store.getState().edit("add", addNode(box("cup_1", "table_1")));
    store.getState().edit("add", addNode(box("spoon_1", "cup_1")));
    store.getState().edit("remove", removeNodes(["table_1"]));
    const { nodes } = store.getState().world;
    expect(nodes.table_1 ?? nodes.cup_1 ?? nodes.spoon_1).toBeUndefined();
  });

  it("refuses duplicate ids", () => {
    const store = makeStore();
    expect(() => store.getState().edit("dup", addNode(box("box_1")))).toThrow(/already exists/);
  });

  it("generates readable, unused ids", () => {
    const world = loadDefaultWorld();
    expect(nextNodeId(world, "box")).toBe("box_2");
    expect(nextNodeId(world, "Wooden Cabin")).toBe("wooden_cabin_1");
    expect(nextNodeId(world, "3 trees")).toBe("n_3_trees_1");
    expect(nextNodeId(world, "!!!")).toBe("node_1");
  });
});
