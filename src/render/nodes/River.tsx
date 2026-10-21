"use client";

import { useMemo } from "react";
import { BufferAttribute, BufferGeometry } from "three";
import type { SceneNode } from "@/scene/schema";
import { sceneStore, useScene } from "@/scene/store";
import { riversOf, type River as RiverShape } from "@/scene/terrain";
import { scatterKey } from "@/layout/scatter";
import { DEFAULT_WATER, WaterMaterial } from "./water";

/** Water ribbon along a river's channel, at the water level of each stretch. */
export function River({ node, onSelect }: { node: SceneNode; onSelect: () => void }) {
  // Re-derive when the river, its endpoints or the terrain change.
  const key = useScene((s) => scatterKey(s.world));
  const geometry = useMemo(() => {
    void key;
    const river = riversOf(sceneStore.getState().world).find((r) => r.id === node.id);
    return river ? ribbon(river) : null;
  }, [key, node]);

  if (!geometry) return null;
  return (
    <mesh
      geometry={geometry}
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <WaterMaterial color={String(node.procedural?.params.color ?? DEFAULT_WATER)} />
    </mesh>
  );
}

function ribbon(river: RiverShape): BufferGeometry {
  const { points, levels } = river;
  // Slightly wider than the channel so the edge tucks under the banks.
  const half = river.half * 1.08;
  const positions = new Float32Array(points.length * 2 * 3);
  const uvs = new Float32Array(points.length * 2 * 2);
  const index: number[] = [];
  let along = 0;

  points.forEach((p, i) => {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    if (i > 0) along += Math.hypot(p.x - prev.x, p.z - prev.z);
    for (const [k, side] of [
      [0, 1],
      [1, -1],
    ] as const) {
      positions.set([p.x + nx * half * side, levels[i]!, p.z + nz * half * side], (i * 2 + k) * 3);
      uvs.set([k, along / (half * 2)], (i * 2 + k) * 2);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
