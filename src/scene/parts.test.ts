import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "@/agent/system-prompt";
import { partBounds, partsFrame, rotate } from "./parts";
import { PartSchema, type Part } from "./schema";

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 5));

describe("custom object parts", () => {
  it("rotates like three.js (XYZ Euler, degrees)", () => {
    close(rotate([1, 0, 0], [0, 0, 90]), [0, 1, 0]);
    close(rotate([1, 0, 0], [0, 90, 0]), [0, 0, -1]);
    close(rotate([0, 1, 0], [90, 0, 0]), [0, 0, 1]);
  });

  it("bounds a rotated box, a lathe, an extrusion and a tube", () => {
    // A 4 x 1 board turned 90 degrees stands 4 tall.
    const board = partBounds({ shape: "box", size: [4, 1, 0.2], rotation: [0, 0, 90] });
    expect(board.max[1] - board.min[1]).toBeCloseTo(4);
    const vase = partBounds({
      shape: "lathe",
      position: [0, 0, 0],
      profile: [
        [0.5, 0],
        [0.8, 1],
        [0.3, 2],
      ],
    });
    close(vase.min, [-0.8, 0, -0.8]);
    close(vase.max, [0.8, 2, 0.8]);
    const star = partBounds({
      shape: "extrude",
      size: [1, 1, 0.4],
      outline: [
        [0, 0],
        [2, 0],
        [1, 3],
      ],
    });
    close(star.min, [0, 0, -0.2]);
    close(star.max, [2, 3, 0.2]);
    const rail = partBounds({
      shape: "tube",
      size: [0.2, 1, 1],
      path: [
        [0, 1, 0],
        [3, 1, 0],
      ],
    });
    close(rail.min, [-0.1, 0.9, -0.1]);
    close(rail.max, [3.1, 1.1, 0.1]);
  });

  it("frames an off-centre design to a bottom-centre origin", () => {
    const parts: Part[] = [
      { shape: "box", position: [5, 2, 0], size: [2, 4, 2] },
      { shape: "sphere", position: [5, 5, 0], size: [2, 2, 2] },
    ];
    const { size, offset } = partsFrame(parts);
    close(size, [2, 6, 2]);
    close(offset, [-5, 0, -0]);
  });

  it("needs a profile, outline or path for the shapes that use one", () => {
    expect(PartSchema.safeParse({ shape: "lathe" }).success).toBe(false);
    expect(
      PartSchema.safeParse({
        shape: "extrude",
        outline: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
      }).success,
    ).toBe(true);
  });

  it("the example design in the system prompt is valid", () => {
    const json = SYSTEM_PROMPT.match(/Example windmill: (\{.*\})/)?.[1];
    expect(json).toBeTruthy();
    const { parts } = JSON.parse(json!) as { parts: unknown[] };
    for (const part of parts) expect(PartSchema.safeParse(part).success).toBe(true);
    // It stands on the ground and is roughly windmill-sized.
    const { size } = partsFrame(parts as Part[]);
    expect(size[1]).toBeGreaterThan(7);
    expect(size[1]).toBeLessThan(11);
  });
});
