"use client";

import type { SceneNode } from "@/scene/schema";
import { lakeWaterLevel } from "@/scene/terrain";
import { useScene } from "@/scene/store";
import { DEFAULT_WATER, WaterMaterial } from "./water";

/** Animated water disc. The terrain carves the bowl; this is just the surface. */
export function Lake({ node, onSelect }: { node: SceneNode; onSelect: () => void }) {
  const terrain = useScene((s) => s.world.environment.terrain);
  const radius = Number(node.procedural?.params.radius ?? node.transform.scale[0] / 2);
  const [x, , z] = node.transform.position;
  const level = lakeWaterLevel(terrain, { x, z, radius });

  return (
    <mesh
      position={[x, level, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <circleGeometry args={[radius * 1.02, 72]} />
      <WaterMaterial color={String(node.procedural?.params.color ?? DEFAULT_WATER)} />
    </mesh>
  );
}
