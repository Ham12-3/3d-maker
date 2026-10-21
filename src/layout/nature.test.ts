import { describe, expect, it } from "vitest";
import { loadDefaultWorld } from "@/scene/defaults";
import type { SceneNode, World } from "@/scene/schema";
import { getHeightField, getWorldHeightField, lakeWaterLevel, waterLevelAt } from "@/scene/terrain";
import { distanceToPolyline, pathPolyline } from "./paths";
import { scatterFeature } from "./scatter";
import { solvePlacements } from "./solver";

function feature(
  id: string,
  type: NonNullable<SceneNode["procedural"]>["type"],
  x: number,
  z: number,
  params: Record<string, number | string>,
): SceneNode {
  const r = Number(params.radius ?? 5);
  return {
    id,
    name: id,
    kind: "procedural",
    procedural: { type, params, seed: 11 },
    transform: { position: [x, 0, z], rotation: [0, 0, 0], scale: [r * 2, 0.1, r * 2] },
    relations: [],
    tags: [type],
    createdBy: "agent",
  };
}

function lakeWorld(): World {
  const world = loadDefaultWorld();
  world.nodes = {};
  world.nodes.lake_1 = feature("lake_1", "lake", 0, -20, { radius: 10 });
  return world;
}

describe("lakes", () => {
  it("carve a bowl below the water level and leave the land beyond the shore alone", () => {
    const world = lakeWorld();
    const h = getWorldHeightField(world);
    const base = getHeightField(world.environment.terrain);
    const level = lakeWaterLevel(world.environment.terrain, { x: 0, z: -20, radius: 10 });
    expect(h(0, -20)).toBeLessThan(level - 1);
    expect(h(0, -20 + 9.95)).toBeLessThan(level + 0.3);
    expect(h(0, -20 + 14)).toBeCloseTo(base(0, -20 + 14), 6);
    expect(waterLevelAt(world, 0, -20)).toBeCloseTo(level);
    expect(waterLevelAt(world, 0, -5)).toBeNull();
  });
});

describe("scatter", () => {
  it("rings a lake with trees, never in the water, spaced apart, deterministically", () => {
    const world = lakeWorld();
    world.nodes.forest_1 = feature("forest_1", "forest", 0, -20, {
      radius: 28,
      innerRadius: 12,
      count: 40,
    });
    const trees = scatterFeature(world, world.nodes.forest_1);
    expect(trees.length).toBeGreaterThanOrEqual(36);
    for (const t of trees) {
      const d = Math.hypot(t.x, t.z + 20);
      expect(d).toBeGreaterThan(11.4);
      expect(d).toBeLessThanOrEqual(28.01);
    }
    for (let i = 0; i < trees.length; i++)
      for (let j = i + 1; j < trees.length; j++)
        expect(
          Math.hypot(trees[i]!.x - trees[j]!.x, trees[i]!.z - trees[j]!.z),
        ).toBeGreaterThanOrEqual(3.6);
    expect(scatterFeature(world, world.nodes.forest_1)).toEqual(trees);
  });

  it("clears a spot for real objects", () => {
    const world = lakeWorld();
    world.nodes.forest_1 = feature("forest_1", "forest", 0, -20, {
      radius: 28,
      innerRadius: 12,
      count: 60,
    });
    world.nodes.cabin_1 = {
      ...feature("cabin_1", "lake", 15, -20, {}),
      kind: "asset",
      procedural: undefined,
      asset: { source: "kenney", id: "tent", url: "/x.glb", license: "CC0" },
      transform: { position: [15, 0, -20], rotation: [0, 0, 0], scale: [5, 4, 5] },
    };
    for (const t of scatterFeature(world, world.nodes.forest_1)) {
      expect(Math.hypot(t.x - 15, t.z + 20)).toBeGreaterThan(3.5);
    }
  });
});

describe("paths and water in the solver", () => {
  it("keeps land objects out of the lake and floats boats on it", () => {
    const world = lakeWorld();
    const [bench, canoe] = solvePlacements(
      world,
      [
        {
          id: "bench_1",
          size: [1.2, 0.8, 0.7],
          relations: [{ predicate: "near", target: "lake_1", distance: 2 }],
        },
        {
          id: "canoe_1",
          size: [1.2, 0.7, 4.5],
          relations: [{ predicate: "inside_region", target: "lake_1" }],
          aquatic: true,
        },
      ],
      { pointer: null, camera: world.camera, seed: 5 },
    );
    expect(Math.hypot(bench!.position[0], bench!.position[2] + 20)).toBeGreaterThan(10);
    expect(Math.hypot(canoe!.position[0], canoe!.position[2] + 20)).toBeLessThan(10);
    expect(canoe!.position[1]).toBeCloseTo(waterLevelAt(world, 0, -20)!);
  });

  it("lines lanterns along a path, beside it and not on it", () => {
    const world = lakeWorld();
    world.nodes.cabin_1 = {
      ...feature("cabin_1", "lake", 14, 0, {}),
      kind: "primitive",
      primitive: "box",
      procedural: undefined,
      transform: { position: [14, 0, 0], rotation: [0, 0, 0], scale: [5, 4, 5] },
    };
    world.nodes.path_1 = feature("path_1", "path", 0, 0, {
      from: "cabin_1",
      to: "lake_1",
      width: 1.6,
    });
    const line = pathPolyline(world, world.nodes.path_1);
    const lanterns = solvePlacements(
      world,
      Array.from({ length: 5 }, (_, i) => ({
        id: `lantern_${i + 1}`,
        size: [0.6, 2.2, 0.6] as [number, number, number],
        relations: [{ predicate: "along_edge_of" as const, target: "path_1" }],
        group: { index: i, size: 5 },
      })),
      { pointer: null, camera: world.camera, seed: 3 },
    );
    for (const l of lanterns) {
      const d = distanceToPolyline(line, { x: l.position[0], z: l.position[2] });
      expect(d).toBeGreaterThan(0.8);
      expect(d).toBeLessThan(1.5 + 0.8);
      expect(l.unsatisfied).toEqual([]);
    }
  });
});
