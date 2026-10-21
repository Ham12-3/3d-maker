import { describe, expect, it } from "vitest";
import { loadDefaultWorld } from "@/scene/defaults";
import { createSceneStore } from "@/scene/store";
import { StreamPreview, stablePart, useGhosts } from "./preview";
import { mockSearchAllAssets, mockSearchAssets } from "./test-helpers";
import type { ToolContext } from "./tools/types";

function setup() {
  const store = createSceneStore(loadDefaultWorld());
  const ctx: ToolContext = {
    getWorld: () => store.getState().world,
    edit: (label, recipe) => store.getState().edit(label, recipe),
    selection: null,
    pointer: null,
    camera: store.getState().world.camera,
    seed: 1,
    moveCamera: () => {},
    say: () => {},
    searchAssets: mockSearchAssets,
    searchAllAssets: mockSearchAllAssets,
    candidates: new Map(),
  };
  let visible = 0;
  const preview = new StreamPreview(ctx, () => visible++);
  useGhosts.setState({ ghosts: [] });
  return { store, preview, visible: () => visible };
}

describe("stablePart", () => {
  it("drops the entry that may still be streaming", () => {
    expect(stablePart({ a: 1, b: { c: 2 }, d: "ha" })).toEqual({ a: 1, b: { c: 2 } });
    expect(stablePart([1, 2, 3])).toEqual([1, 2]);
    expect(stablePart("x")).toBeUndefined();
  });
});

describe("StreamPreview", () => {
  it("applies finished environment fields before the tool call completes", () => {
    const { store, preview, visible } = setup();
    // "sky" is still streaming ("suns..."), so only timeOfDay is final.
    preview.update("b1", "set_environment", { timeOfDay: 18, sky: "suns" });
    expect(store.getState().world.environment.timeOfDay).toBe(18);
    expect(store.getState().world.environment.sky).toBe("clear");
    expect(visible()).toBe(1);
    // A half-written value that fails validation is ignored.
    preview.update("b1", "set_environment", {
      timeOfDay: 18,
      fog: { color: "#e9" },
      sky: "sunset",
    });
    expect(store.getState().world.environment.fog.color).toBe("#c9d6e3");
  });

  it("shows ghost boxes for objects whose input has finished streaming", () => {
    const { preview } = setup();
    preview.update("b2", "add_objects", {
      objects: [
        {
          name: "lantern",
          asset_query: "lantern",
          count: 2,
          relations: [{ predicate: "near", target: "box_1" }],
        },
        // Still streaming: not shown yet.
        { name: "ben" },
      ],
    });
    const ghosts = useGhosts.getState().ghosts;
    expect(ghosts).toHaveLength(2);
    // Sized from the bundled kit before any model loads.
    expect(ghosts[0]!.size[1]).toBeCloseTo(2.2);
    preview.clearBlock("b2");
    expect(useGhosts.getState().ghosts).toEqual([]);
  });

  it("shows a ring for a forest around a lake once its type is final", () => {
    const { store, preview } = setup();
    store.getState().edit("lake", (d) => {
      d.nodes.lake_1 = {
        id: "lake_1",
        name: "lake",
        kind: "procedural",
        procedural: { type: "lake", params: { radius: 10 }, seed: 1 },
        transform: { position: [0, 0, -30], rotation: [0, 0, 0], scale: [20, 0.1, 20] },
        relations: [],
        tags: ["lake"],
        createdBy: "agent",
      };
    });
    preview.update("b3", "add_procedural", { type: "fore" });
    expect(useGhosts.getState().ghosts).toEqual([]);
    preview.update("b3", "add_procedural", {
      type: "forest",
      relations: [{ predicate: "around", target: "lake_1" }],
      count: 4,
    });
    const [ring] = useGhosts.getState().ghosts;
    expect(ring?.shape).toBe("ring");
    expect(ring?.inner).toBeGreaterThan(10);
    preview.clearAll();
    expect(useGhosts.getState().ghosts).toEqual([]);
  });
});
