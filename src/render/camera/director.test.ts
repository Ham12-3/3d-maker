import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/download";
import { extensionFor, pickMimeType } from "./recording";
import { computeShot, moveStart, withCut, type Focus } from "./shots";

const focus: Focus = { center: [10, 0, -5], radius: 6, height: 4 };
const camera = {
  position: [10, 8, 30] as [number, number, number],
  target: [10, 0, -5] as [number, number, number],
  fov: 50,
};
const dist = (p: number[], c = focus.center) => Math.hypot(p[0]! - c[0], p[2]! - c[2]);

describe("director shots", () => {
  it("reveal cranes up and back from low and close", () => {
    const shot = computeShot("reveal", focus, camera);
    if (shot.kind !== "path") throw new Error("expected a path");
    const [first, , last] = shot.points;
    expect(last![1]).toBeGreaterThan(first![1]);
    expect(dist(last!)).toBeGreaterThan(dist(first!));
  });

  it("push_in moves towards the subject", () => {
    const shot = computeShot("push_in", focus, camera);
    if (shot.kind !== "path") throw new Error("expected a path");
    expect(dist(shot.points.at(-1)!)).toBeLessThan(dist(shot.points[0]!));
  });

  it("stands further back in a 9:16 frame and still respects fog", () => {
    const wide = computeShot("orbit", focus, camera, undefined, Infinity, 16 / 9);
    const tall = computeShot("orbit", focus, camera, undefined, Infinity, 9 / 16);
    const foggy = computeShot("orbit", focus, camera, undefined, 15, 9 / 16);
    if (wide.kind !== "orbit" || tall.kind !== "orbit" || foggy.kind !== "orbit") throw new Error();
    expect(tall.radius).toBeGreaterThan(wide.radius);
    expect(foggy.radius).toBeLessThanOrEqual(15);
  });

  it("keeps every shot of a huge scene inside the world", () => {
    const huge: Focus = { center: [-20, 0, -25], radius: 60, height: 6 };
    for (const kind of ["establishing", "orbit", "flyover", "reveal", "push_in"] as const) {
      const shot = computeShot(kind, huge, camera, undefined, Infinity, 9 / 16);
      const points =
        shot.kind === "tween"
          ? [shot.position]
          : shot.kind === "path"
            ? shot.points
            : Array.from({ length: 16 }, (_, i) => {
                const a = shot.startAngle + (i / 16) * Math.PI * 2;
                return [
                  shot.target[0] + Math.sin(a) * shot.radius,
                  0,
                  shot.target[2] + Math.cos(a) * shot.radius,
                ];
              });
      for (const p of points) {
        expect(Math.abs(p[0]!), kind).toBeLessThan(120);
        expect(Math.abs(p[2]!), kind).toBeLessThan(120);
      }
    }
  });

  it("a cut starts exactly on the move's first frame", () => {
    const orbit = withCut(computeShot("orbit", focus, camera));
    expect(orbit).toMatchObject({ cut: true });
    const start = moveStart(orbit);
    if (orbit.kind !== "orbit") throw new Error();
    expect(dist(start.position, orbit.target)).toBeCloseTo(orbit.radius);
    const path = withCut(computeShot("flyover", focus, camera));
    if (path.kind !== "path") throw new Error();
    expect(moveStart(path).position).toEqual(path.points[0]);
  });
});

describe("recording helpers", () => {
  it("prefers MP4 and falls back to WebM", () => {
    expect(pickMimeType(() => true)).toMatch(/^video\/mp4/);
    expect(pickMimeType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9");
    expect(pickMimeType(() => false)).toBeNull();
    expect(extensionFor("video/mp4")).toBe("mp4");
    expect(extensionFor("video/webm")).toBe("webm");
  });

  it("slugifies titles for file names", () => {
    expect(slugify("Cosy Village by the River!")).toBe("cosy-village-by-the-river");
    expect(slugify("!!!")).toBe("world");
  });
});
