"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { CatmullRomCurve3, Vector3 } from "three";
import type { Vec3 } from "@/scene/schema";
import { useDirector } from "./director";
import { moveStart, type CameraMove } from "./shots";

const ORBIT_LEAD_IN = 1.2;

/** The bits of drei's OrbitControls the rig uses. */
type Controls = {
  target: Vector3;
  update: () => void;
  addEventListener: (type: "start" | "end", listener: () => void) => void;
  removeEventListener: (type: "start" | "end", listener: () => void) => void;
};

type Playing = {
  move: CameraMove;
  elapsed: number;
  fromPos: Vector3;
  fromTarget: Vector3;
  curve?: CatmullRomCurve3;
  lookCurve?: CatmullRomCurve3;
};

/** Plays camera moves requested by the agent; any user drag cancels the move. */
export function CameraRig() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const move = useDirector((s) => s.move);
  const moveId = useDirector((s) => s.moveId);
  const playing = useRef<Playing | null>(null);

  // Mirror the live camera into the director whenever the user stops dragging.
  useEffect(() => {
    if (!controls) return;
    const publish = () =>
      useDirector.getState().setLive({
        position: camera.position.toArray() as Vec3,
        target: controls.target.toArray() as Vec3,
        fov: "fov" in camera ? (camera.fov as number) : 50,
      });
    const cancel = () => {
      if (playing.current) {
        playing.current = null;
        useDirector.getState().stop();
      }
    };
    controls.addEventListener("end", publish);
    controls.addEventListener("start", cancel);
    return () => {
      controls.removeEventListener("end", publish);
      controls.removeEventListener("start", cancel);
    };
  }, [camera, controls]);

  useEffect(() => {
    if (!move || !controls) return;
    if (move.kind !== "tween" && move.cut) {
      const start = moveStart(move);
      camera.position.set(...start.position);
      controls.target.set(...start.target);
      controls.update();
    }
    const p: Playing = {
      move,
      elapsed: 0,
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
    };
    if (move.kind === "path") {
      // A cut starts on the path itself; otherwise fly in from where we are.
      const lead = move.cut ? [] : [camera.position.clone()];
      const leadLook = move.cut ? [] : [controls.target.clone()];
      p.curve = new CatmullRomCurve3([...lead, ...move.points.map((v) => new Vector3(...v))]);
      p.lookCurve = new CatmullRomCurve3([
        ...leadLook,
        ...move.lookAt.map((v) => new Vector3(...v)),
      ]);
    }
    playing.current = p;
  }, [move, moveId, camera, controls]);

  useFrame((_, dt) => {
    const p = playing.current;
    if (!p || !controls) return;
    p.elapsed += Math.min(dt, 0.1);
    const { move } = p;
    let done = false;

    if (move.kind === "tween") {
      const t = Math.min(1, p.elapsed / move.duration);
      const k = easeInOutCubic(t);
      camera.position.lerpVectors(p.fromPos, new Vector3(...move.position), k);
      controls.target.lerpVectors(p.fromTarget, new Vector3(...move.target), k);
      done = t >= 1;
    } else if (move.kind === "orbit") {
      const target = new Vector3(...move.target);
      const at = (angle: number) =>
        new Vector3(
          target.x + Math.sin(angle) * move.radius,
          target.y + move.height,
          target.z + Math.cos(angle) * move.radius,
        );
      const leadIn = move.cut ? 0 : ORBIT_LEAD_IN;
      if (p.elapsed < leadIn) {
        const k = easeInOutCubic(p.elapsed / leadIn);
        camera.position.lerpVectors(p.fromPos, at(move.startAngle), k);
        controls.target.lerpVectors(p.fromTarget, target, k);
      } else {
        const t = Math.min(1, (p.elapsed - leadIn) / move.duration);
        camera.position.copy(at(move.startAngle + easeInOutSine(t) * move.turns * Math.PI * 2));
        controls.target.copy(target);
        done = t >= 1;
      }
    } else if (p.curve && p.lookCurve) {
      const t = Math.min(1, p.elapsed / move.duration);
      const k = easeInOutSine(t);
      camera.position.copy(p.curve.getPoint(k));
      controls.target.copy(p.lookCurve.getPoint(k));
      done = t >= 1;
    }

    controls.update();
    if (done) {
      playing.current = null;
      useDirector.getState().stop();
      useDirector.getState().setLive({
        position: camera.position.toArray() as Vec3,
        target: controls.target.toArray() as Vec3,
        fov: "fov" in camera ? (camera.fov as number) : 50,
      });
    }
  });

  return null;
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeInOutSine(t: number) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}
