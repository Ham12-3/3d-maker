import type { CameraState, Vec3 } from "@/scene/schema";

/**
 * Camera shots as pure maths: turn "establishing shot of the cabin" into a
 * camera move the CameraRig can play. No React, no three.js.
 */

export const SHOT_KINDS = [
  "establishing",
  "close_up",
  "orbit",
  "flyover",
  "first_person",
  "reveal",
  "push_in",
] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];

export type CameraMove =
  | { kind: "tween"; position: Vec3; target: Vec3; duration: number }
  | {
      kind: "orbit";
      target: Vec3;
      radius: number;
      height: number;
      startAngle: number;
      turns: number;
      duration: number;
      /** Start on the orbit (a cut) instead of gliding onto it. */
      cut?: boolean;
    }
  | {
      kind: "path";
      points: Vec3[];
      lookAt: Vec3[];
      duration: number;
      /** Start at points[0] (a cut) instead of flying there from the current view. */
      cut?: boolean;
    };

export type Focus = {
  /** Ground-level centre of what we're looking at. */
  center: Vec3;
  /** Rough radius of the subject in metres. */
  radius: number;
  /** Height of the subject in metres. */
  height: number;
};

const DEG = Math.PI / 180;

/**
 * How far you can see through exp2 fog before things are more than half
 * fogged out. Shots never pull back further than this.
 */
export function fogVisibility(fog: { enabled: boolean; density: number }): number {
  return fog.enabled && fog.density > 0 ? 0.85 / fog.density : Infinity;
}

/**
 * `aspect` is the frame's width/height. Narrow frames (a 9:16 reel) see less
 * sideways, so shots stand further back to keep the subject in frame.
 */
export function computeShot(
  kind: ShotKind,
  focus: Focus,
  camera: CameraState,
  duration?: number,
  maxDistance = Infinity,
  aspect = 16 / 9,
): CameraMove {
  const [fx, fy, fz] = focus.center;
  const fit = Math.sqrt(Math.max(1, 1.2 / aspect));
  // Keep the viewer on the side they're already looking from.
  const azimuth = Math.atan2(camera.position[0] - fx, camera.position[2] - fz);
  const lookAt: Vec3 = [fx, fy + focus.height * 0.4, fz];

  const from = (distance: number, elevation: number): Vec3 => [
    fx + Math.sin(azimuth) * distance * Math.cos(elevation),
    fy + Math.max(1, distance * Math.sin(elevation)),
    fz + Math.cos(azimuth) * distance * Math.cos(elevation),
  ];

  switch (kind) {
    case "establishing": {
      const ideal = Math.max(28, focus.radius * 2.5) * fit;
      const distance = Math.max(12, Math.min(ideal, maxDistance));
      // When fog keeps us close, look down more steeply to still take it all in.
      const elevation = distance < ideal ? 48 * DEG : 32 * DEG;
      return {
        kind: "tween",
        position: from(distance, elevation),
        target: lookAt,
        duration: duration ?? 2.2,
      };
    }
    case "close_up":
      return {
        kind: "tween",
        position: from(Math.max(3, focus.radius * 2.6 + focus.height) * fit, 14 * DEG),
        target: lookAt,
        duration: duration ?? 1.6,
      };
    case "first_person": {
      const eye = from(Math.max(4, focus.radius * 2.5), 0);
      return {
        kind: "tween",
        position: [eye[0], fy + 1.7, eye[2]],
        target: [fx, fy + 1.5, fz],
        duration: duration ?? 1.8,
      };
    }
    case "orbit": {
      const radius = Math.min(Math.max(8, focus.radius * 3) * fit, Math.max(8, maxDistance));
      return {
        kind: "orbit",
        target: lookAt,
        radius,
        height: Math.max(3, radius * 0.45),
        startAngle: azimuth,
        turns: 1,
        duration: duration ?? 14,
      };
    }
    case "flyover": {
      // A sweeping pass across the front: in high from one side, down low
      // past the subject, up and out the other side, always looking at it
      // (flying straight over would end on empty terrain).
      const reach = Math.min(Math.max(24, focus.radius * 2.2) * fit, Math.max(20, maxDistance));
      const high = Math.max(12, focus.radius * 0.9);
      const low = Math.max(5, focus.radius * 0.35);
      const out = { x: Math.sin(azimuth), z: Math.cos(azimuth) };
      const side = { x: out.z, z: -out.x };
      const at = (along: number, away: number, h: number): Vec3 => [
        fx + side.x * reach * along + out.x * reach * away,
        fy + h,
        fz + side.z * reach * along + out.z * reach * away,
      ];
      const look = (along: number): Vec3 => at(along, 0, lookAt[1] - fy);
      return {
        kind: "path",
        points: [
          at(-0.8, 0.75, high),
          at(-0.25, 0.5, low),
          at(0.25, 0.5, low),
          at(0.8, 0.75, high),
        ],
        lookAt: [look(-0.1), lookAt, lookAt, look(0.1)],
        duration: duration ?? 10,
      };
    }
    case "reveal": {
      // Crane shot: start low and close, rise and pull back to take it all in.
      const far = Math.max(12, Math.min(Math.max(28, focus.radius * 2.5) * fit, maxDistance));
      const near = Math.max(4, focus.radius * 0.6 + focus.height);
      return {
        kind: "path",
        points: [from(near, 4 * DEG), from((near + far) / 2, 20 * DEG), from(far, 38 * DEG)],
        lookAt: [
          [fx, fy + Math.max(2, focus.height * 0.8), fz],
          [fx, fy + focus.height * 0.5, fz],
          lookAt,
        ],
        duration: duration ?? 8,
      };
    }
    case "push_in": {
      // Slow dolly towards the subject at a low angle.
      const start = Math.min(Math.max(10, focus.radius * 3) * fit, Math.max(10, maxDistance));
      const end = Math.max(3, focus.radius * 1.1 + focus.height * 0.5);
      return {
        kind: "path",
        points: [from(start, 12 * DEG), from((start + end) / 2, 10 * DEG), from(end, 8 * DEG)],
        lookAt: [lookAt, lookAt, lookAt],
        duration: duration ?? 7,
      };
    }
  }
}

/** Where a move begins when it starts with a cut. */
export function moveStart(move: CameraMove): { position: Vec3; target: Vec3 } {
  switch (move.kind) {
    case "tween":
      return { position: move.position, target: move.target };
    case "orbit": {
      const [tx, ty, tz] = move.target;
      return {
        position: [
          tx + Math.sin(move.startAngle) * move.radius,
          ty + move.height,
          tz + Math.cos(move.startAngle) * move.radius,
        ],
        target: move.target,
      };
    }
    case "path":
      return { position: move.points[0]!, target: move.lookAt[0]! };
  }
}

/** The same move, starting with a cut (for recordings). */
export function withCut(move: CameraMove): CameraMove {
  return move.kind === "tween" ? move : { ...move, cut: true };
}
