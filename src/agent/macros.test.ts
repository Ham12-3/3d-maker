import { describe, expect, it } from "vitest";
import { loadDefaultWorld } from "@/scene/defaults";
import { createSceneStore } from "@/scene/store";
import { nearestWater, waterBodies } from "@/scene/terrain";
import { BUILT_IN_MACROS, findMacro, generaliseSteps, instantiateMacro } from "./macros";
import { mockSearchAllAssets, mockSearchAssets } from "./test-helpers";
import { executeToolCall } from "./tools";
import type { RecordedStep, ToolContext } from "./tools/types";

function setup() {
  const store = createSceneStore(loadDefaultWorld());
  const ctx: ToolContext = {
    getWorld: () => store.getState().world,
    edit: (label, recipe) => store.getState().edit(label, recipe),
    selection: null,
    pointer: null,
    camera: store.getState().world.camera,
    seed: 2,
    moveCamera: () => {},
    say: () => {},
    searchAssets: mockSearchAssets,
    searchAllAssets: mockSearchAllAssets,
    candidates: new Map(),
    recorder: [],
  };
  const world = () => store.getState().world;
  return { store, ctx, world };
}

/** Build a little village by the pond, recording the steps like a real turn. */
async function buildVillage(ctx: ToolContext): Promise<RecordedStep[]> {
  await executeToolCall("remove_objects", { tag: "demo" }, ctx);
  await executeToolCall(
    "add_procedural",
    {
      type: "lake",
      id: "pond_1",
      radius: 8,
      relations: [{ predicate: "behind", target: "origin", distance: 20 }],
    },
    ctx,
  );
  ctx.recorder = [];
  await executeToolCall(
    "add_objects",
    {
      objects: [
        {
          id: "well_1",
          name: "stone well",
          shape: "cylinder",
          size: [2, 1.2, 2],
          relations: [{ predicate: "near", target: "pond_1", distance: 4 }],
          position: [3, 0, 3],
        },
        {
          name: "cottage",
          asset_query: "house",
          size: [6, 5, 6],
          count: 3,
          relations: [
            { predicate: "around", target: "well_1", distance: 8 },
            { predicate: "facing", target: "well_1" },
          ],
        },
      ],
    },
    ctx,
  );
  await executeToolCall(
    "add_procedural",
    { type: "flowers", count: 30, relations: [{ predicate: "around", target: "well_1" }] },
    ctx,
  );
  return ctx.recorder!;
}

describe("macros", () => {
  it("record building steps with the ids they created", async () => {
    const { ctx } = setup();
    const steps = await buildVillage(ctx);
    expect(steps.map((s) => s.tool)).toEqual(["add_objects", "add_procedural"]);
    expect(steps[0]!.created).toEqual(["well_1", "cottage_1", "cottage_2", "cottage_3"]);
  });

  it("generalise to placeholders and an anchor, with no coordinates", async () => {
    const { ctx, world } = setup();
    const steps = generaliseSteps(await buildVillage(ctx), world());
    const json = JSON.stringify(steps);
    expect(json).not.toContain("pond_1");
    expect(json).not.toContain("well_1");
    expect(json).not.toContain("position");
    expect(json).toContain('"target":"$anchor"');
    expect(json).toContain('"target":"$well"');
    const objects = (steps[0]!.input as { objects: { id: string }[] }).objects;
    expect(objects.map((o) => o.id)).toEqual(["$well", "$cottage"]);
  });

  it("save this, then make another one by the river", async () => {
    const { ctx, world } = setup();
    const steps = await buildVillage(ctx);
    ctx.recorder = [];
    ctx.previousTurn = { command: "build a little village by the pond", steps };
    const saved = await executeToolCall("save_macro", { name: "cosy village" }, ctx);
    expect(saved.isError).toBe(false);
    expect(world().macros.cosy_village?.builtIn).toBe(false);

    await executeToolCall(
      "add_procedural",
      { type: "river", id: "river_1", from: "-60,30", to: "60,40" },
      ctx,
    );
    const r = await executeToolCall(
      "apply_macro",
      { name: "cosy village", anchor: { target: "river_1" }, include_environment: false },
      ctx,
    );
    expect(r.isError).toBe(false);
    expect(r.content).toMatch(/3\/3 steps ok|2\/2 steps ok/);

    const w = world();
    // A second village with fresh ids, next to the river, out of the water.
    expect(w.nodes.well_2).toBeDefined();
    expect(Object.keys(w.nodes).filter((id) => id.startsWith("cottage_"))).toHaveLength(6);
    const water = waterBodies(w);
    const well2 = w.nodes.well_2!.transform.position;
    const toRiver = nearestWater(water, well2[0], well2[2])!;
    expect(toRiver.distance).toBeGreaterThan(0);
    expect(toRiver.distance).toBeLessThan(10);
    // The new cottages circle the new well, not the old one.
    for (const id of ["cottage_4", "cottage_5", "cottage_6"]) {
      const p = w.nodes[id]!;
      expect(p.relations[0]?.target).toBe("well_2");
    }
  });

  it("refuses to save when nothing was built", async () => {
    const { ctx } = setup();
    expect((await executeToolCall("save_macro", { name: "nothing" }, ctx)).isError).toBe(true);
  });

  it.each(Object.keys(BUILT_IN_MACROS))("built-in %s instantiates and runs cleanly", async (id) => {
    const { ctx, world } = setup();
    const calls = instantiateMacro(findMacro(world(), id)!, world(), { target: "origin" });
    expect(JSON.stringify(calls)).not.toContain("$");
    const r = await executeToolCall("apply_macro", { name: id }, ctx);
    expect(r.isError).toBe(false);
    expect(r.content).not.toMatch(/ERROR/);
  });
});
