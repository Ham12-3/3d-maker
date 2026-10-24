import type { Part, Vec3 } from "./schema";

/**
 * Bounds of custom objects built from parts (pure maths, no three.js), shared
 * by the tool (natural size), the solver (via the node's scale) and the
 * renderer (normalising the parts to a unit box at the bottom-centre).
 */

export type Box3 = { min: Vec3; max: Vec3 };

const DEG = Math.PI / 180;

/** The part's own box before rotation, relative to its position. */
function localBox(part: Part): Box3 {
  const [w, h, d] = part.size ?? [1, 1, 1];
  switch (part.shape) {
    case "lathe": {
      const pts = part.profile ?? [[0, 0]];
      const r = Math.max(...pts.map((p) => Math.abs(p[0])));
      const ys = pts.map((p) => p[1]);
      return { min: [-r, Math.min(...ys), -r], max: [r, Math.max(...ys), r] };
    }
    case "extrude": {
      const pts = part.outline ?? [[0, 0]];
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return {
        min: [Math.min(...xs), Math.min(...ys), -d / 2],
        max: [Math.max(...xs), Math.max(...ys), d / 2],
      };
    }
    case "tube": {
      const pts = part.path ?? [[0, 0, 0]];
      const r = w / 2;
      const axis = (i: 0 | 1 | 2) => pts.map((p) => p[i]);
      return {
        min: [Math.min(...axis(0)) - r, Math.min(...axis(1)) - r, Math.min(...axis(2)) - r],
        max: [Math.max(...axis(0)) + r, Math.max(...axis(1)) + r, Math.max(...axis(2)) + r],
      };
    }
    default:
      return { min: [-w / 2, -h / 2, -d / 2], max: [w / 2, h / 2, d / 2] };
  }
}

/** Rotate by Euler angles (degrees, XYZ order like three.js). */
export function rotate([x, y, z]: Vec3, [rx, ry, rz]: Vec3): Vec3 {
  const [a, b, c] = [rx * DEG, ry * DEG, rz * DEG];
  // R = Rx · Ry · Rz applied to the vector (three.js "XYZ").
  let [px, py, pz] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c), z];
  [px, pz] = [px * Math.cos(b) + pz * Math.sin(b), -px * Math.sin(b) + pz * Math.cos(b)];
  [py, pz] = [py * Math.cos(a) - pz * Math.sin(a), py * Math.sin(a) + pz * Math.cos(a)];
  return [px, py, pz];
}

export function partBounds(part: Part): Box3 {
  const { min, max } = localBox(part);
  const pos = part.position ?? [0, 0, 0];
  const rot = part.rotation ?? [0, 0, 0];
  const out: Box3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < 8; i++) {
    const corner: Vec3 = [
      i & 1 ? max[0] : min[0],
      i & 2 ? max[1] : min[1],
      i & 4 ? max[2] : min[2],
    ];
    const p = rotate(corner, rot);
    for (let k = 0; k < 3; k++) {
      const v = p[k]! + pos[k]!;
      out.min[k] = Math.min(out.min[k]!, v);
      out.max[k] = Math.max(out.max[k]!, v);
    }
  }
  return out;
}

export function partsBounds(parts: Part[]): Box3 {
  const out: Box3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const part of parts) {
    const b = partBounds(part);
    for (let k = 0; k < 3; k++) {
      out.min[k] = Math.min(out.min[k]!, b.min[k]!);
      out.max[k] = Math.max(out.max[k]!, b.max[k]!);
    }
  }
  return out;
}

/**
 * Natural size of the object in metres, and the offset that moves its
 * bottom-centre to the origin (parts may not be authored centred).
 */
export function partsFrame(parts: Part[]): { size: Vec3; offset: Vec3 } {
  const { min, max } = partsBounds(parts);
  const size = [0, 1, 2].map((k) => Math.max(0.01, max[k]! - min[k]!)) as Vec3;
  return {
    size,
    offset: [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2],
  };
}
