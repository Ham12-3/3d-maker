import { describe, expect, it } from "vitest";
import { createRng } from "@/lib/random";
import { sunDirection, daylight } from "@/render/sun";
import { FLAT_RADIUS, createHeightField, getHeightField } from "./terrain";

const SAMPLES: [number, number][] = [
  [30, 10],
  [-45, 60],
  [80, -20],
  [5, -90],
];

describe("terrain height field", () => {
  it("is deterministic for the same params", () => {
    const a = createHeightField({ type: "hills", seed: 42, height: 8 });
    const b = createHeightField({ type: "hills", seed: 42, height: 8 });
    for (const [x, z] of SAMPLES) expect(a(x, z)).toBe(b(x, z));
  });

  it("changes with the seed", () => {
    const a = createHeightField({ type: "hills", seed: 1, height: 8 });
    const b = createHeightField({ type: "hills", seed: 2, height: 8 });
    expect(SAMPLES.some(([x, z]) => a(x, z) !== b(x, z))).toBe(true);
  });

  it("keeps the build area flat at y = 0 for every type", () => {
    for (const type of ["flat", "hills", "island", "valley"] as const) {
      const heightAt = createHeightField({ type, seed: 7, height: 20 });
      const rng = createRng(3);
      for (let i = 0; i < 50; i++) {
        const angle = rng() * Math.PI * 2;
        const r = rng() * FLAT_RADIUS;
        expect(heightAt(Math.cos(angle) * r, Math.sin(angle) * r)).toBeCloseTo(0, 6);
      }
    }
  });

  it("stays within the requested height for hills", () => {
    const heightAt = createHeightField({ type: "hills", seed: 9, height: 10 });
    for (let x = -120; x <= 120; x += 6) {
      for (let z = -120; z <= 120; z += 6) {
        const h = heightAt(x, z);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(10);
      }
    }
  });

  it("caches height fields by params", () => {
    const params = { type: "valley", seed: 5, height: 12 } as const;
    expect(getHeightField(params)).toBe(getHeightField({ ...params }));
  });
});

describe("sun", () => {
  it("is overhead-ish at noon and below the horizon at midnight", () => {
    expect(sunDirection(12)[1]).toBeGreaterThan(0.9);
    expect(sunDirection(0)[1]).toBeLessThan(0);
    expect(daylight(12)).toBe(1);
    expect(daylight(0)).toBe(0);
  });

  it("rises in the east and sets in the west", () => {
    expect(sunDirection(7)[0]).toBeGreaterThan(0);
    expect(sunDirection(17)[0]).toBeLessThan(0);
  });
});
