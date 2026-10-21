import { describe, expect, it } from "vitest";
import { judgeWorld } from "@/agent/judge";
import { scatterFeature } from "@/layout/scatter";
import { loadDefaultWorld } from "@/scene/defaults";
import { createSceneStore } from "@/scene/store";
import {
  getWorldHeightField,
  nearestWater,
  riversOf,
  waterBodies,
  waterLevelAt,
} from "@/scene/terrain";
import { mockSearchAllAssets, mockSearchAssets } from "../test-helpers";
import { executeToolCall } from "./index";
import type { ToolContext } from "./types";

function setup() {
  const store = createSceneStore(loadDefaultWorld());
  const ctx: ToolContext = {
    getWorld: () => store.getState().world,
    edit: (label, recipe) => store.getState().edit(label, recipe),
    selection: null,
    pointer: null,
    camera: store.getState().world.camera,
    seed: 4,
    moveCamera: () => {},
    say: () => {},
    searchAssets: mockSearchAssets,
    searchAllAssets: mockSearchAllAssets,
    candidates: new Map(),
  };
  return { store, ctx, world: () => store.getState().world };
}

describe("nature tools", () => {
  it("builds a misty lake ringed by pines with a cabin facing it on the shore", async () => {
    const { ctx, world } = setup();
    const run = (name: string, input: unknown) => executeToolCall(name, input, ctx);

    expect(
      (
        await run("add_procedural", {
          type: "lake",
          id: "lake_1",
          radius: 11,
          relations: [{ predicate: "behind", target: "sphere_1", distance: 14 }],
        })
      ).isError,
    ).toBe(false);
    const forest = await run("add_procedural", {
      type: "forest",
      species: "pine",
      count: 50,
      radius: 18,
      relations: [{ predicate: "around", target: "lake_1" }],
    });
    expect(forest.isError).toBe(false);
    const cabin = await run("add_objects", {
      objects: [
        {
          id: "cabin_1",
          name: "wooden cabin",
          asset_query: "log cabin",
          size: [6, 4.5, 5],
          relations: [
            { predicate: "near", target: "lake_1", distance: 3 },
            { predicate: "facing", target: "lake_1" },
          ],
        },
      ],
    });
    expect(cabin.isError).toBe(false);
    expect(cabin.content).toMatch(/Log Cabin/);

    const w = world();
    const lake = w.nodes.lake_1!;
    const c = w.nodes.cabin_1!;
    expect(c.kind).toBe("asset");
    expect(c.asset?.license).toBe("CC-BY");
    expect(c.asset?.attribution).toMatch(/Test Author/);

    // On the shore: out of the water, close to it, standing on the ground.
    const d = Math.hypot(
      c.transform.position[0] - lake.transform.position[0],
      c.transform.position[2] - lake.transform.position[2],
    );
    expect(d).toBeGreaterThan(11);
    expect(d).toBeLessThan(11 + 3 + 3.5 + 1);
    expect(c.transform.position[1]).toBeCloseTo(
      getWorldHeightField(w)(c.transform.position[0], c.transform.position[2]),
      2,
    );

    // Trees keep clear of the water and of the cabin.
    const trees = scatterFeature(
      w,
      w.nodes[Object.keys(w.nodes).find((id) => id.includes("forest"))!]!,
    );
    expect(trees.length).toBeGreaterThan(30);
    for (const t of trees) {
      expect(
        Math.hypot(t.x - lake.transform.position[0], t.z - lake.transform.position[2]),
      ).toBeGreaterThan(11);
      expect(
        Math.hypot(t.x - c.transform.position[0], t.z - c.transform.position[2]),
      ).toBeGreaterThan(3);
    }

    // And the judge finds nothing to fix.
    const report = judgeWorld(w, new Set(Object.keys(w.nodes)));
    expect(report.fixed).toEqual([]);
    expect(report.hard).toEqual([]);
  });

  it("pushes existing objects out when a lake appears under them", async () => {
    const { ctx, world } = setup();
    const r = await executeToolCall(
      "add_procedural",
      {
        type: "lake",
        id: "pond_1",
        radius: 6,
        relations: [{ predicate: "near", target: "origin", distance: 0.1 }],
      },
      ctx,
    );
    expect(r.isError).toBe(false);
    const w = world();
    const pond = w.nodes.pond_1!;
    for (const n of Object.values(w.nodes)) {
      if (n.kind !== "primitive") continue;
      expect(waterLevelAt(w, n.transform.position[0], n.transform.position[2])).toBeNull();
    }
    expect(pond.procedural?.type).toBe("lake");
  });

  it("uses the bundled kit for known things and boxes for unknown ones", async () => {
    const { ctx, world } = setup();
    const r = await executeToolCall(
      "add_objects",
      {
        objects: [
          { name: "lantern", asset_query: "lantern", count: 2 },
          { name: "spaceship", asset_query: "spaceship" },
        ],
      },
      ctx,
    );
    expect(r.isError).toBe(false);
    expect(world().nodes.lantern_1?.asset?.source).toBe("kenney");
    expect(world().nodes.lantern_2?.transform.scale[1]).toBeCloseTo(2.2);
    expect(world().nodes.spaceship_1?.primitive).toBe("box");
    expect(r.content).toMatch(/no model found for "spaceship"/);
  });

  it("lays a path and lines lanterns along it", async () => {
    const { ctx, world } = setup();
    await executeToolCall(
      "add_procedural",
      { type: "path", id: "path_1", from: "box_1", to: "cone_1" },
      ctx,
    );
    const r = await executeToolCall(
      "add_objects",
      {
        objects: [
          {
            name: "lantern",
            asset_query: "lantern",
            count: 4,
            relations: [{ predicate: "along_edge_of", target: "path_1" }],
          },
        ],
      },
      ctx,
    );
    expect(r.content).not.toMatch(/could not satisfy/);
    expect(Object.values(world().nodes).filter((n) => n.tags.includes("lantern"))).toHaveLength(4);
  });

  it("search_assets lists ids add_objects can use", async () => {
    const { ctx, world } = setup();
    const found = await executeToolCall("search_assets", { query: "house" }, ctx);
    expect(found.content).toMatch(/polypizza:fakeHouse01/);
    await executeToolCall(
      "add_objects",
      { objects: [{ name: "house", asset_id: "polypizza:fakeHouse01", size: [7, 5, 6] }] },
      ctx,
    );
    expect(world().nodes.house_1?.asset?.url).toBe("/api/assets/file/fakeHouse01");
  });

  it("create_region names an area other tools can fill", async () => {
    const { ctx, world } = setup();
    await executeToolCall(
      "create_region",
      { id: "village_square", shape: "rect", size: [12, 8] },
      ctx,
    );
    expect(world().regions.village_square?.size).toEqual([12, 0, 8]);
    const r = await executeToolCall(
      "add_procedural",
      { type: "flowers", region: "village_square", count: 30 },
      ctx,
    );
    expect(r.content).toMatch(/inside village_square/);
  });
});

describe("rivers", () => {
  it("carve a channel across the view and push objects in its way onto the banks", async () => {
    const { ctx, world } = setup();
    const r = await executeToolCall(
      "add_procedural",
      {
        type: "river",
        id: "river_1",
        relations: [{ predicate: "near", target: "origin", distance: 0.1 }],
      },
      ctx,
    );
    expect(r.isError).toBe(false);
    const w = world();
    const river = riversOf(w)[0]!;
    expect(river.half).toBe(3);
    // Water in the channel, carved ground below it.
    const mid = river.points[Math.floor(river.points.length / 2)]!;
    const level = waterLevelAt(w, mid.x, mid.z);
    expect(level).not.toBeNull();
    expect(getWorldHeightField(w)(mid.x, mid.z)).toBeLessThan(level! - 0.5);
    // Every demo primitive near the origin is now dry and on the ground.
    for (const n of Object.values(w.nodes).filter((x) => x.kind === "primitive")) {
      expect(waterLevelAt(w, n.transform.position[0], n.transform.position[2])).toBeNull();
      expect(n.transform.position[1]).toBeCloseTo(
        getWorldHeightField(w)(n.transform.position[0], n.transform.position[2]),
        2,
      );
    }
  });

  it("places things by the river on the bank, and forests avoid the water", async () => {
    const { ctx, world } = setup();
    await executeToolCall("remove_objects", { tag: "demo" }, ctx);
    await executeToolCall(
      "add_procedural",
      { type: "river", id: "river_1", from: "-60,-20", to: "60,-10" },
      ctx,
    );
    await executeToolCall(
      "add_objects",
      {
        objects: [
          {
            name: "tent",
            asset_query: "tent",
            count: 3,
            relations: [{ predicate: "near", target: "river_1", distance: 2 }],
          },
        ],
      },
      ctx,
    );
    await executeToolCall(
      "add_procedural",
      {
        type: "forest",
        radius: 30,
        count: 60,
        relations: [{ predicate: "near", target: "river_1" }],
      },
      ctx,
    );
    const w = world();
    const water = waterBodies(w);
    const tents = Object.values(w.nodes).filter((n) => n.tags.includes("tent"));
    expect(tents).toHaveLength(3);
    for (const t of tents) {
      const hit = nearestWater(water, t.transform.position[0], t.transform.position[2])!;
      expect(hit.distance).toBeGreaterThan(0.5);
      expect(hit.distance).toBeLessThan(6);
    }
    const forest = Object.values(w.nodes).find((n) => n.procedural?.type === "forest")!;
    for (const tree of scatterFeature(w, forest)) {
      expect(nearestWater(water, tree.x, tree.z)!.distance).toBeGreaterThan(1.5);
    }
  });
});

describe("judge", () => {
  it("sets floating things down, lifts buried ones and reports broken models", () => {
    const world = loadDefaultWorld();
    world.nodes.box_1!.transform.position = [-3, 2, 0];
    world.nodes.pillar_1!.transform.position = [3.5, -1, 0.5];
    world.nodes.cabin_1 = {
      ...world.nodes.box_1!,
      id: "cabin_1",
      kind: "asset",
      primitive: undefined,
      asset: { source: "polypizza", id: "x", url: "/api/assets/file/x", license: "CC0" },
      transform: { position: [-8, 0, 6], rotation: [0, 0, 0], scale: [4, 3, 4] },
    };
    const report = judgeWorld(world, new Set(["box_1", "pillar_1", "cabin_1"]), {
      "/api/assets/file/x": "404",
    });
    expect(report.fixes.get("box_1")?.[1]).toBeCloseTo(0);
    expect(report.fixes.get("pillar_1")?.[1]).toBeCloseTo(0);
    expect(report.hard.map((i) => i.kind)).toEqual(["broken_asset"]);
  });

  it("pushes an overlapping newcomer apart and ignores stacked pairs", () => {
    const world = loadDefaultWorld();
    world.nodes.crate_1 = {
      ...world.nodes.box_1!,
      id: "crate_1",
      transform: { ...world.nodes.box_1!.transform, position: [-2.5, 0, 0.2] },
    };
    world.nodes.cup_1 = {
      ...world.nodes.box_1!,
      id: "cup_1",
      relations: [{ predicate: "on_top_of", target: "box_1" }],
      transform: { position: [-3, 1.5, 0], rotation: [0, 0, 0], scale: [0.3, 0.3, 0.3] },
    };
    const report = judgeWorld(world, new Set(["crate_1", "cup_1"]));
    const moved = report.fixes.get("crate_1")!;
    expect(Math.abs(moved[0] - -3)).toBeGreaterThan(1.3);
    expect(report.fixes.has("cup_1")).toBe(false);
    expect(report.hard).toEqual([]);
  });
});

describe("model sizing", () => {
  it("fits kit models inside the requested box instead of scaling by height alone", async () => {
    const { sizeFor } = await import("./add-objects");
    const campfire = {
      source: "kenney" as const,
      id: "campfire",
      name: "campfire",
      url: "/x.glb",
      license: "CC0" as const,
      size: [1.2, 0.42, 1.18] as [number, number, number],
      tags: [],
      score: 1,
    };
    const size = sizeFor({ size: [1.5, 0.7, 1.5] }, { kind: "asset", candidate: campfire });
    expect(size[0]).toBeLessThanOrEqual(1.5);
    expect(size[2]).toBeLessThanOrEqual(1.5);
    expect(size[1]).toBeLessThanOrEqual(0.7);
    // Proportions kept.
    expect(size[0] / size[1]).toBeCloseTo(1.2 / 0.42, 1);
  });
});
