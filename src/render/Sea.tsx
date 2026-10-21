"use client";

import type { Environment } from "@/scene/schema";
import { TERRAIN_SIZE } from "@/scene/terrain";
import { WaterMaterial } from "./nodes/water";

/** Sea level around island terrain (the island's edges dip below it). */
export const SEA_LEVEL = -0.4;

export function Sea({ terrain }: { terrain: Environment["terrain"] }) {
  if (terrain.type !== "island") return null;
  return (
    <mesh
      position={[0, SEA_LEVEL, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      raycast={() => {}}
    >
      <planeGeometry args={[TERRAIN_SIZE * 4, TERRAIN_SIZE * 4]} />
      <WaterMaterial color="#2f7f9f" />
    </mesh>
  );
}
