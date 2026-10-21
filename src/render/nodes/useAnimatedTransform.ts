"use client";

import { useFrame } from "@react-three/fiber";
import { useRef, type RefObject } from "react";
import type { Group } from "three";
import type { SceneNode } from "@/scene/schema";

const POP_DURATION = 0.5;
const MOVE_RATE = 8;
const MIN_SCALE = 0.001;

/**
 * Pops a node in from zero scale with a small overshoot when it first
 * appears (with a little stagger so batches ripple in), then eases towards
 * its transform whenever it moves, turns or resizes.
 */
export function useAnimatedTransform(ref: RefObject<Group | null>, node: SceneNode) {
  const state = useRef({ age: -staggerDelay(node.id), popped: false });
  const { position, rotation, scale } = node.transform;

  useFrame((_, rawDt) => {
    const g = ref.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.1);
    const s = state.current;

    if (!s.popped) {
      s.age += dt;
      const p = Math.max(0, Math.min(1, s.age / POP_DURATION));
      const e = Math.max(MIN_SCALE, easeOutBack(p));
      g.position.set(position[0], position[1], position[2]);
      g.rotation.set(rotation[0], rotation[1], rotation[2]);
      g.scale.set(scale[0] * e, scale[1] * e, scale[2] * e);
      if (p >= 1) s.popped = true;
      return;
    }

    const k = 1 - Math.exp(-dt * MOVE_RATE);
    g.position.x += (position[0] - g.position.x) * k;
    g.position.y += (position[1] - g.position.y) * k;
    g.position.z += (position[2] - g.position.z) * k;
    g.rotation.x += shortestAngle(g.rotation.x, rotation[0]) * k;
    g.rotation.y += shortestAngle(g.rotation.y, rotation[1]) * k;
    g.rotation.z += shortestAngle(g.rotation.z, rotation[2]) * k;
    g.scale.x += (scale[0] - g.scale.x) * k;
    g.scale.y += (scale[1] - g.scale.y) * k;
    g.scale.z += (scale[2] - g.scale.z) * k;
  });
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function shortestAngle(from: number, to: number): number {
  const d = (to - from) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
}

/** 0-200 ms, stable per id, so objects added together ripple in. */
function staggerDelay(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 6) * 0.04;
}
