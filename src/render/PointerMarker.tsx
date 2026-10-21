"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh } from "three";
import { useInteraction } from "@/scene/interaction";

/** Pulsing ring where the user last clicked the ground ("put it there"). */
export function PointerMarker() {
  const pointer = useInteraction((s) => s.pointer);
  const ring = useRef<Mesh>(null);

  useFrame(({ clock }) => {
    if (!ring.current) return;
    const s = 1 + Math.sin(clock.elapsedTime * 4) * 0.12;
    ring.current.scale.set(s, s, s);
  });

  if (!pointer) return null;
  return (
    <mesh
      ref={ring}
      position={[pointer[0], pointer[1] + 0.03, pointer[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <ringGeometry args={[0.35, 0.5, 40]} />
      <meshBasicMaterial color="#9fd3ff" transparent opacity={0.85} depthWrite={false} />
    </mesh>
  );
}
