"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { DoubleSide, type Group, type MeshBasicMaterial } from "three";
import { useGhosts, type Ghost } from "@/agent/preview";

/**
 * Placeholders for things Claude is still describing: translucent boxes for
 * objects and discs/rings for areas, shown while the tool input streams in.
 */
export function Ghosts() {
  const ghosts = useGhosts((s) => s.ghosts);
  const group = useRef<Group>(null);

  // One gentle pulse for all of them.
  useFrame(({ clock }) => {
    const pulse = 0.18 + 0.1 * Math.sin(clock.elapsedTime * 5);
    group.current?.traverse((o) => {
      const material = (o as { material?: MeshBasicMaterial }).material;
      if (material && "opacity" in material) material.opacity = pulse;
    });
  });

  return (
    <group ref={group}>
      {ghosts.map((g) => (
        <GhostShape key={g.key} ghost={g} />
      ))}
    </group>
  );
}

function GhostShape({ ghost }: { ghost: Ghost }) {
  const [x, y, z] = ghost.position;
  if (ghost.shape === "box") {
    const [w, h, d] = ghost.size;
    return (
      <mesh position={[x, y + h / 2, z]} scale={[w, h, d]} raycast={() => {}}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={ghost.color} transparent opacity={0.25} depthWrite={false} />
      </mesh>
    );
  }
  const outer = ghost.size[0] / 2;
  return (
    <mesh position={[x, y + 0.15, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
      <ringGeometry args={[ghost.shape === "ring" ? (ghost.inner ?? 0) : 0, outer, 64]} />
      <meshBasicMaterial
        color={ghost.color}
        transparent
        opacity={0.25}
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
  );
}
