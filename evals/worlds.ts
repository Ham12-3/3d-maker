import { loadDefaultWorld } from "@/scene/defaults";
import type { SceneNode, World } from "@/scene/schema";
import { lakeWaterLevel } from "@/scene/terrain";

/** Starting worlds for eval cases, built in code so the case files stay short. */
export function baseWorld(name: string): World {
  const world = loadDefaultWorld();
  if (name === "default") return world;
  if (name === "empty") {
    world.nodes = {};
    return world;
  }
  if (name === "lake") {
    world.nodes = {};
    const r = 10;
    const level = lakeWaterLevel(world.environment.terrain, { x: 0, z: -22, radius: r });
    add(world, feature("lake_1", "lake", [0, level, -22], { radius: r }, ["lake", "water"]));
    add(
      world,
      feature(
        "forest_1",
        "forest",
        [0, 0, -22],
        { radius: 30, innerRadius: 15.5, count: 40, species: "pine" },
        ["forest", "tree", "pine"],
        [{ predicate: "around", target: "lake_1" }],
      ),
    );
    add(
      world,
      feature("path_1", "path", [0, 0, -4], { from: "0,6", to: "lake_1", width: 1.6 }, ["path"]),
    );
    add(world, {
      id: "rock_2",
      name: "large rock",
      kind: "asset",
      asset: {
        source: "kenney",
        id: "rock_large_a",
        url: "/assets/kenney/nature/rock_largeA.glb",
        license: "CC0",
      },
      transform: { position: [-7, 0, 2], rotation: [0, 0, 0], scale: [1.6, 1.8, 2.1] },
      relations: [],
      tags: ["rock", "boulder"],
      createdBy: "agent",
    });
    add(world, {
      id: "pine_lone_1",
      name: "lone pine",
      kind: "asset",
      asset: {
        source: "kenney",
        id: "pine_a",
        url: "/assets/kenney/nature/tree_pineDefaultA.glb",
        license: "CC0",
      },
      transform: { position: [9, 0, 3], rotation: [0, 0, 0], scale: [3, 8, 3] },
      relations: [],
      tags: ["tree", "pine"],
      createdBy: "agent",
    });
    return world;
  }
  throw new Error(`unknown base world "${name}"`);
}

function add(world: World, node: SceneNode) {
  world.nodes[node.id] = node;
}

function feature(
  id: string,
  type: NonNullable<SceneNode["procedural"]>["type"],
  position: SceneNode["transform"]["position"],
  params: Record<string, number | string>,
  tags: string[],
  relations: SceneNode["relations"] = [],
): SceneNode {
  const r = Number(params.radius ?? 1);
  return {
    id,
    name: id.replace(/_\d+$/, ""),
    kind: "procedural",
    procedural: { type, params, seed: 21 },
    transform: { position, rotation: [0, 0, 0], scale: [r * 2, 1, r * 2] },
    relations,
    tags,
    createdBy: "agent",
  };
}
