import { describe, expect, it } from "vitest";
import type { CameraMove } from "@/render/camera/shots";
import { loadDefaultWorld } from "@/scene/defaults";
import { createSceneStore } from "@/scene/store";
import { executeToolCall, toolDefinitions } from "./index";
import { mockSearchAllAssets, mockSearchAssets } from "../test-helpers";
import type { ToolContext } from "./types";

function setup(selection: string | null = null) {
  const store = createSceneStore(loadDefaultWorld());
  const moves: CameraMove[] = [];
  const said: string[] = [];
  const ctx: ToolContext = {
    getWorld: () => store.getState().world,
    edit: (label, recipe) => store.getState().edit(label, recipe),
    selection,
    pointer: null,
    camera: store.getState().world.camera,
    seed: 1,
    moveCamera: (m) => moves.push(m),
    say: (t) => said.push(t),
    searchAssets: mockSearchAssets,
    searchAllAssets: mockSearchAllAssets,
    candidates: new Map(),
  };
  return { store, ctx, moves, said, world: () => store.getState().world };
}

describe("tool definitions", () => {
  it("generates object JSON schemas from zod", async () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.name)).toEqual([
      "set_environment",
      "add_procedural",
      "add_objects",
      "update_objects",
      "remove_objects",
      "create_region",
      "search_assets",
      "save_macro",
      "apply_macro",
      "capture_view",
      "set_camera",
      "say",
    ]);
    for (const def of defs) {
      expect(def.input_schema.type).toBe("object");
      expect(def.input_schema).not.toHaveProperty("$schema");
      expect(def.description!.length).toBeGreaterThan(40);
    }
    expect(defs.find((d) => d.name === "add_objects")?.eager_input_streaming).toBe(true);
    expect(defs.find((d) => d.name === "say")?.eager_input_streaming).toBeUndefined();
  });
});

describe("tools", () => {
  it("set_environment merges nested fields", async () => {
    const { ctx, world } = setup();
    const r = await executeToolCall(
      "set_environment",
      { timeOfDay: 18, sky: "sunset", fog: { enabled: true } },
      ctx,
    );
    expect(r.isError).toBe(false);
    expect(world().environment).toMatchObject({ timeOfDay: 18, sky: "sunset" });
    expect(world().environment.fog.enabled).toBe(true);
    expect(world().environment.fog.color).toBe("#c9d6e3");
  });

  it("add_objects places a red box next to a new blue sphere (any order)", async () => {
    const { ctx, world } = setup();
    const r = await executeToolCall(
      "add_objects",
      {
        objects: [
          {
            name: "red box",
            shape: "box",
            material: { color: "#d64545" },
            relations: [{ predicate: "next_to", target: "blue_sphere_1" }],
          },
          { id: "blue_sphere_1", name: "blue sphere", shape: "sphere", size: [1.5, 1.5, 1.5] },
        ],
      },
      ctx,
    );
    expect(r.isError).toBe(false);
    expect(r.content).not.toMatch(/could not satisfy/);
    const box = world().nodes.red_box_1!;
    const sphere = world().nodes.blue_sphere_1!;
    expect(box.relations[0]?.target).toBe("blue_sphere_1");
    const d = Math.hypot(
      box.transform.position[0] - sphere.transform.position[0],
      box.transform.position[2] - sphere.transform.position[2],
    );
    expect(d).toBeGreaterThan(1.2);
    expect(d).toBeLessThan(2.6);
  });

  it("add_objects renames a taken id and remaps relations to it", async () => {
    const { ctx, world } = setup();
    await executeToolCall(
      "add_objects",
      {
        objects: [
          { id: "box_1", name: "crate", shape: "box" },
          {
            name: "lamp",
            shape: "cylinder",
            relations: [{ predicate: "on_top_of", target: "box_1" }],
          },
        ],
      },
      ctx,
    );
    // box_1 already exists in the default world, so the crate becomes box_2.
    expect(world().nodes.box_2?.name).toBe("crate");
    expect(world().nodes.lamp_1?.relations[0]?.target).toBe("box_2");
    expect(world().nodes.lamp_1?.transform.position[1]).toBeCloseTo(1);
  });

  it("add_objects with count makes numbered copies", async () => {
    const { ctx, world } = setup();
    await executeToolCall(
      "add_objects",
      {
        objects: [
          {
            name: "pine",
            shape: "cone",
            size: [2, 6, 2],
            count: 5,
            tags: ["tree"],
            relations: [{ predicate: "around", target: "sphere_1", distance: 4 }],
          },
        ],
      },
      ctx,
    );
    const pines = Object.values(world().nodes).filter((n) => n.tags.includes("tree"));
    expect(pines.map((n) => n.id).sort()).toEqual([
      "pine_1",
      "pine_2",
      "pine_3",
      "pine_4",
      "pine_5",
    ]);
  });

  it("update_objects scales the selection and carries stacked objects", async () => {
    const { ctx, world } = setup("box_1");
    await executeToolCall(
      "add_objects",
      {
        objects: [
          {
            name: "cup",
            shape: "cylinder",
            size: [0.3, 0.3, 0.3],
            relations: [{ predicate: "on_top_of", target: "box_1" }],
          },
        ],
      },
      ctx,
    );
    const r = await executeToolCall(
      "update_objects",
      { ids: ["box_1"], changes: { scale_by: 2 } },
      ctx,
    );
    expect(r.isError).toBe(false);
    expect(world().nodes.box_1!.transform.scale).toEqual([3, 3, 3]);
    expect(world().nodes.cup_1!.transform.position[1]).toBeCloseTo(3);
    expect(r.content).toMatch(/Followed along: cup_1/);
  });

  it("update_objects re-places with new relations", async () => {
    const { ctx, world } = setup();
    await executeToolCall(
      "update_objects",
      { ids: ["box_1"], changes: { relations: [{ predicate: "next_to", target: "pillar_1" }] } },
      ctx,
    );
    const box = world().nodes.box_1!.transform.position;
    const pillar = world().nodes.pillar_1!.transform.position;
    expect(Math.hypot(box[0] - pillar[0], box[2] - pillar[2])).toBeLessThan(2.2);
  });

  it("remove_objects by tag, and reports unknown ids", async () => {
    const { ctx, world } = setup();
    const r = await executeToolCall("remove_objects", { tag: "demo" }, ctx);
    expect(r.isError).toBe(false);
    expect(Object.keys(world().nodes)).toEqual([]);
    expect((await executeToolCall("remove_objects", { ids: ["ghost_1"] }, ctx)).isError).toBe(true);
  });

  it("set_camera emits a camera move and say shows text", async () => {
    const { ctx, moves, said } = setup();
    expect(
      (await await executeToolCall("set_camera", { shot: "orbit", target: "pillar_1" }, ctx))
        .isError,
    ).toBe(false);
    expect(moves[0]?.kind).toBe("orbit");
    expect(
      (await await executeToolCall("set_camera", { shot: "close_up", target: "nope_1" }, ctx))
        .isError,
    ).toBe(true);
    await executeToolCall("say", { text: "Done. Want fireflies too?" }, ctx);
    expect(said).toEqual(["Done. Want fireflies too?"]);
  });

  it("returns a readable error for invalid input and unknown tools", async () => {
    const { ctx } = setup();
    const bad = await executeToolCall(
      "add_objects",
      { objects: [{ name: "x", shape: "pyramid" }] },
      ctx,
    );
    expect(bad.isError).toBe(true);
    expect(bad.content).toMatch(/Invalid input for add_objects/);
    expect((await await executeToolCall("teleport", {}, ctx)).isError).toBe(true);
  });

  it("all tool edits inside a transaction undo as one step", async () => {
    const { ctx, store, world } = setup();
    const before = world();
    store.getState().beginTransaction("turn");
    await executeToolCall(
      "set_environment",
      { timeOfDay: 18.2, sky: "sunset", fog: { enabled: true } },
      ctx,
    );
    await executeToolCall("add_objects", { objects: [{ name: "red box", shape: "box" }] }, ctx);
    store.getState().commitTransaction();
    store.getState().undo();
    expect(world()).toEqual(before);
  });
});
