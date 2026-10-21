import type { CameraState, Vec3 } from "@/scene/schema";

/**
 * Camera shots as pure maths: turn "establishing shot of the cabin" into a
 * camera move the CameraRig can play. No React, no three.js.
 */

export type ShotKind = "establishing" | "close_up" | "orbit" | "flyover" | "first_person";

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
    }
  | { kind: "path"; points: Vec3[]; lookAt: Vec3[]; duration: number };

export type Focus = {
  /** Ground-level centre of what we're looking at. */
  center: Vec3;
  /** Rough radius of the subject in metres. */
  radius: number;
  /** Height of the subject in metres. */
  height: number;
};

const DEG = Math.PI / 180;

export function computeShot(
  kind: ShotKind,
  focus: Focus,
  camera: CameraState,
  duration?: number,
): CameraMove {
  const [fx, fy, fz] = focus.center;
  // Keep the viewer on the side they're already looking from.
  const azimuth = Math.atan2(camera.position[0] - fx, camera.position[2] - fz);
  const lookAt: Vec3 = [fx, fy + focus.height * 0.4, fz];

  const from = (distance: number, elevation: number): Vec3 => [
    fx + Math.sin(azimuth) * distance * Math.cos(elevation),
    fy + Math.max(1, distance * Math.sin(elevation)),
    fz + Math.cos(azimuth) * distance * Math.cos(elevation),
  ];

  switch (kind) {
    case "establishing":
      return {
        kind: "tween",
        position: from(Math.max(28, focus.radius * 3.2), 32 * DEG),
        target: lookAt,
        duration: duration ?? 2.2,
      };
    case "close_up":
      return {
        kind: "tween",
        position: from(Math.max(3, focus.radius * 2.6 + focus.height), 14 * DEG),
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
      const radius = Math.max(8, focus.radius * 3);
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
      const reach = Math.max(30, focus.radius * 4);
      const high = Math.max(12, focus.radius * 1.2);
      const low = Math.max(8, focus.radius * 0.8);
      const dir = { x: Math.sin(azimuth), z: Math.cos(azimuth) };
      const at = (t: number, h: number): Vec3 => [
        fx + dir.x * reach * t,
        fy + h,
        fz + dir.z * reach * t,
      ];
      return {
        kind: "path",
        points: [at(1, high), at(0.35, low), at(-0.35, low), at(-1, high)],
        lookAt: [lookAt, lookAt, at(-0.7, 0), at(-1.6, 0)],
        duration: duration ?? 10,
      };
    }
  }
}
