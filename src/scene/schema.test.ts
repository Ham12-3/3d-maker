import { describe, expect, it } from "vitest";
import defaultWorldJson from "./worlds/default.json";
import { loadDefaultWorld } from "./defaults";
import { WorldSchema } from "./schema";

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("world schema", () => {
  it("accepts the default world", () => {
    expect(() => loadDefaultWorld()).not.toThrow();
  });

  it("rejects a primitive node without a shape", () => {
    const json = clone(defaultWorldJson) as Record<string, any>;
    delete json.nodes.box_1.primitive;
    const result = WorldSchema.safeParse(json);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["nodes", "box_1", "primitive"]);
  });

  it("rejects a node whose key does not match its id", () => {
    const json = clone(defaultWorldJson) as Record<string, any>;
    json.nodes.box_1.id = "box_2";
    expect(WorldSchema.safeParse(json).success).toBe(false);
  });

  it("rejects unreadable ids and bad colours", () => {
    const badId = clone(defaultWorldJson) as Record<string, any>;
    badId.nodes["Box 1"] = { ...badId.nodes.box_1, id: "Box 1" };
    expect(WorldSchema.safeParse(badId).success).toBe(false);

    const badColour = clone(defaultWorldJson) as Record<string, any>;
    badColour.environment.fog.color = "grey";
    expect(WorldSchema.safeParse(badColour).success).toBe(false);
  });

  it("requires attribution for CC-BY assets", () => {
    const json = clone(defaultWorldJson) as Record<string, any>;
    json.nodes.cabin_1 = {
      ...json.nodes.box_1,
      id: "cabin_1",
      kind: "asset",
      asset: { source: "polypizza", id: "abc", url: "https://x/y.glb", license: "CC-BY" },
    };
    expect(WorldSchema.safeParse(json).success).toBe(false);
    json.nodes.cabin_1.asset.attribution = "Cabin by Someone (CC-BY)";
    expect(WorldSchema.safeParse(json).success).toBe(true);
  });

  it("rejects a parentId that does not exist", () => {
    const json = clone(defaultWorldJson) as Record<string, any>;
    json.nodes.box_1.parentId = "ghost_1";
    expect(WorldSchema.safeParse(json).success).toBe(false);
  });
});
