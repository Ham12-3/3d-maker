import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KENNEY_MODELS, getKitModel, searchKit, tokenize } from "./catalog";

describe("bundled kit", () => {
  it("has a file and a sane real-world size for every model", () => {
    expect(KENNEY_MODELS.length).toBeGreaterThan(40);
    for (const m of KENNEY_MODELS) {
      expect(existsSync(join(process.cwd(), "public", m.url))).toBe(true);
      expect(m.size).toHaveLength(3);
      for (const v of m.size) expect(v).toBeGreaterThan(0);
      expect(m.size[1]).toBeLessThan(20);
    }
    expect(new Set(KENNEY_MODELS.map((m) => m.id)).size).toBe(KENNEY_MODELS.length);
  });

  it("tokenizes queries", () => {
    expect(tokenize("Some tall Pine Trees")).toEqual(["pine", "tree"]);
  });

  it("finds models by head noun, boosted by the other words", () => {
    expect(searchKit("pine tree")[0]?.tags).toContain("pine");
    expect(searchKit("street lamp")[0]?.id).toBe("lantern_post");
    expect(searchKit("big boulder")[0]?.tags).toContain("rock");
    expect(searchKit("wooden bench")[0]?.id).toBe("bench");
    expect(searchKit("boat")[0]?.id).toBe("canoe");
  });

  it("does not match on adjectives alone", () => {
    expect(searchKit("wooden cabin")).toEqual([]);
    expect(searchKit("red car")).toEqual([]);
  });

  it("looks up by id", () => {
    expect(getKitModel("tent")?.name).toBe("tent");
    expect(getKitModel("nope")).toBeUndefined();
  });
});
