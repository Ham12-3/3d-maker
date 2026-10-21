import { describe, expect, it } from "vitest";
import { loadDefaultWorld } from "@/scene/defaults";
import type { SceneNode, Vec3, World } from "@/scene/schema";
import { footprintAt, footprintsOverlap } from "./spatial-hash";
import {
  followMovedAnchors,
  solvePlacements,
  type PlacementItem,
  type SolveContext,
} from "./solver";

function emptyWorld(): World {
  const world = loadDefaultWorld();
  world.nodes = {};
  world.environment.terrain = { ...world.environment.terrain, type: "flat" };
  return world;
}

function box(
  id: string,
  position: Vec3,
  size: Vec3 = [1, 1, 1],
  extra: Partial<SceneNode> = {},
): SceneNode {
  return {
    id,
    name: id,
    kind: "primitive",
    primitive: "box",
    transform: { position, rotation: [0, 0, 0], scale: size },
    relations: [],
    tags: [],
    createdBy: "agent",
    ...extra,
  };
}

const ctx = (world: World, pointer: Vec3 | null = null): SolveContext => ({
  pointer,
  camera: world.camera,
  seed: 7,
});

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

function overlaps(a: { position: Vec3; size: Vec3 }, b: { position: Vec3; size: Vec3 }) {
  return footprintsOverlap(
    footprintAt(a.position[0], a.position[2], a.size[0], a.size[2]),
    footprintAt(b.position[0], b.position[2], b.size[0], b.size[2]),
  );
}

describe("layout solver", () => {
  it("places next_to a node: touching distance, no overlap", () => {
    const world = emptyWorld();
    world.nodes.sphere_1 = box("sphere_1", [0, 0, 0], [1.6, 1.6, 1.6]);
    const [p] = solvePlacements(
      world,
      [{ id: "box_1", size: [1, 1, 1], relations: [{ predicate: "next_to", target: "sphere_1" }] }],
      ctx(world),
    );
    expect(p!.unsatisfied).toEqual([]);
    const gap = dist(p!.position, [0, 0, 0]) - 0.8 - 0.5;
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(1.2);
    expect(
      overlaps(
        { position: p!.position, size: [1, 1, 1] },
        { position: [0, 0, 0], size: [1.6, 1.6, 1.6] },
      ),
    ).toBe(false);
  });

  it("resolves relations to items placed earlier in the same batch", () => {
    const world = emptyWorld();
    const [sphere, cube] = solvePlacements(
      world,
      [
        { id: "sphere_1", size: [1.5, 1.5, 1.5], relations: [] },
        { id: "box_1", size: [1, 1, 1], relations: [{ predicate: "next_to", target: "sphere_1" }] },
      ],
      ctx(world, [5, 0, -3]),
    );
    expect(dist(sphere!.position, [5, 0, -3])).toBeLessThan(6);
    expect(cube!.unsatisfied).toEqual([]);
    expect(dist(cube!.position, sphere!.position)).toBeLessThan(2.5);
  });

  it("stacks on_top_of at the target's top surface", () => {
    const world = emptyWorld();
    world.nodes.table_1 = box("table_1", [2, 0, 2], [2, 0.8, 1]);
    const [p] = solvePlacements(
      world,
      [
        {
          id: "cup_1",
          size: [0.2, 0.2, 0.2],
          relations: [{ predicate: "on_top_of", target: "table_1" }],
        },
      ],
      ctx(world),
    );
    expect(p!.position[1]).toBeCloseTo(0.8);
    expect(Math.abs(p!.position[0] - 2)).toBeLessThanOrEqual(0.9);
    expect(Math.abs(p!.position[2] - 2)).toBeLessThanOrEqual(0.4);
  });

  it("spreads a group evenly around a target without overlaps", () => {
    const world = emptyWorld();
    world.nodes.well_1 = box("well_1", [0, 0, 0], [2, 1, 2]);
    const items: PlacementItem[] = Array.from({ length: 6 }, (_, i) => ({
      id: `pine_${i + 1}`,
      size: [1.2, 6, 1.2],
      relations: [{ predicate: "around", target: "well_1", distance: 4 }],
      group: { index: i, size: 6 },
    }));
    const placements = solvePlacements(world, items, ctx(world));
    const angles = placements
      .map((p) => Math.atan2(p.position[2], p.position[0]))
      .sort((a, b) => a - b);
    for (const p of placements) {
      expect(dist(p.position, [0, 0, 0])).toBeGreaterThan(3.5);
      expect(dist(p.position, [0, 0, 0])).toBeLessThan(7);
    }
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        expect(
          overlaps(
            { position: placements[i]!.position, size: [1.2, 6, 1.2] },
            { position: placements[j]!.position, size: [1.2, 6, 1.2] },
          ),
        ).toBe(false);
      }
    }
    // Roughly even spacing: no two neighbours closer than a third of the ideal step.
    const step = (Math.PI * 2) / 6;
    for (let i = 1; i < angles.length; i++)
      expect(angles[i]! - angles[i - 1]!).toBeGreaterThan(step / 3);
  });

  it("places inside a region", () => {
    const world = emptyWorld();
    world.regions.square = { id: "square", shape: "rect", center: [10, 0, 10], size: [6, 0, 4] };
    const placements = solvePlacements(
      world,
      Array.from({ length: 4 }, (_, i) => ({
        id: `crate_${i + 1}`,
        size: [1, 1, 1] as Vec3,
        relations: [],
        region: "square",
        group: { index: i, size: 4 },
      })),
      ctx(world),
    );
    for (const p of placements) {
      expect(p.unsatisfied).toEqual([]);
      expect(Math.abs(p.position[0] - 10)).toBeLessThanOrEqual(3);
      expect(Math.abs(p.position[2] - 10)).toBeLessThanOrEqual(2);
    }
  });

  it("faces the target", () => {
    const world = emptyWorld();
    world.regions.lake_area = {
      id: "lake_area",
      shape: "circle",
      center: [0, 0, -20],
      size: [16, 0, 16],
    };
    const [p] = solvePlacements(
      world,
      [
        {
          id: "cabin_1",
          size: [5, 4, 4],
          relations: [
            { predicate: "near", target: "lake_area", distance: 3 },
            { predicate: "facing", target: "lake_area" },
          ],
        },
      ],
      ctx(world),
    );
    const yaw = p!.rotation[1];
    const toLake = { x: 0 - p!.position[0], z: -20 - p!.position[2] };
    const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const cos = (forward.x * toLake.x + forward.z * toLake.z) / Math.hypot(toLake.x, toLake.z);
    expect(cos).toBeGreaterThan(0.99);
    expect(dist(p!.position, [0, 0, -20])).toBeLessThan(8 + 2.5 + 3 + 0.5);
  });

  it("puts left_of / in_front_of on the right side relative to the camera", () => {
    const world = emptyWorld(); // camera at +z looking towards -z
    world.nodes.tree_1 = box("tree_1", [0, 0, 0]);
    const [left, front] = solvePlacements(
      world,
      [
        { id: "a_1", size: [1, 1, 1], relations: [{ predicate: "left_of", target: "tree_1" }] },
        { id: "b_1", size: [1, 1, 1], relations: [{ predicate: "in_front_of", target: "tree_1" }] },
      ],
      ctx(world),
    );
    expect(left!.position[0]).toBeLessThan(-0.5);
    expect(front!.position[2]).toBeGreaterThan(0.5);
  });

  it("snaps to terrain height", () => {
    const world = loadDefaultWorld();
    world.nodes = {};
    const [p] = solvePlacements(
      world,
      [{ id: "rock_1", size: [1, 1, 1], relations: [], position: [60, 0, 40] }],
      ctx(world),
    );
    expect(p!.position[1]).toBeGreaterThan(0);
  });

  it("is deterministic for the same seed", () => {
    const world = emptyWorld();
    world.nodes.well_1 = box("well_1", [0, 0, 0], [2, 1, 2]);
    const items: PlacementItem[] = [
      { id: "x_1", size: [1, 1, 1], relations: [{ predicate: "near", target: "well_1" }] },
    ];
    expect(solvePlacements(world, items, ctx(world))).toEqual(
      solvePlacements(world, items, ctx(world)),
    );
  });

  it("reports unknown targets", () => {
    const world = emptyWorld();
    const [p] = solvePlacements(
      world,
      [{ id: "x_1", size: [1, 1, 1], relations: [{ predicate: "near", target: "ghost_9" }] }],
      ctx(world),
    );
    expect(p!.unsatisfied[0]).toMatch(/unknown target "ghost_9"/);
  });
});

describe("followMovedAnchors", () => {
  it("carries dependants along and re-aims facing", () => {
    const world = emptyWorld();
    world.nodes.table_1 = box("table_1", [0, 0, 0], [2, 1, 1]);
    world.nodes.cup_1 = box("cup_1", [0.3, 1, 0], [0.2, 0.2, 0.2], {
      relations: [{ predicate: "on_top_of", target: "table_1" }],
    });
    world.nodes.spoon_1 = box("spoon_1", [0.3, 1.2, 0], [0.1, 0.05, 0.1], {
      relations: [{ predicate: "on_top_of", target: "cup_1" }],
    });
    world.nodes.chair_1 = box("chair_1", [0, 0, 5], [1, 1, 1], {
      relations: [{ predicate: "facing", target: "table_1" }],
    });

    const before = new Map([["table_1", [0, 0, 0] as Vec3]]);
    world.nodes.table_1!.transform.position = [4, 0, 0];
    const followed = followMovedAnchors(world, ["table_1"], before);

    expect(followed.sort()).toEqual(["cup_1", "spoon_1"]);
    expect(world.nodes.cup_1!.transform.position).toEqual([4.3, 1, 0]);
    expect(world.nodes.spoon_1!.transform.position).toEqual([4.3, 1.2, 0]);
    expect(world.nodes.chair_1!.transform.position).toEqual([0, 0, 5]);
    // Chair at (0, 5) now faces (4, 0).
    expect(world.nodes.chair_1!.transform.rotation[1]).toBeCloseTo(Math.atan2(4, -5), 2);
  });
});
