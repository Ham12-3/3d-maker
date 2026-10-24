import { describe, expect, it } from "vitest";
import { loadDefaultWorld } from "@/scene/defaults";
import { decodeWorld, encodeWorld, worldFromHash } from "./link";

describe("worlds packed into links", () => {
  it("round-trips a world through a compact, URL-safe string", async () => {
    const world = { ...loadDefaultWorld(), title: "Cosy village ✨" };
    const encoded = await encodeWorld(world);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded.length).toBeLessThan(JSON.stringify(world).length);
    expect(await decodeWorld(encoded)).toEqual(world);
  });

  it("reads the world from a #world= hash and rejects damaged links", async () => {
    expect(worldFromHash("#world=abc")).toBe("abc");
    expect(worldFromHash("#other")).toBeNull();
    await expect(decodeWorld("not-a-world")).rejects.toThrow();
  });
});
