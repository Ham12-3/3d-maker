"use client";

import { useMemo } from "react";
import { BufferAttribute, BufferGeometry } from "three";
import { pathPolyline, pathWidth } from "@/layout/paths";
import type { SceneNode } from "@/scene/schema";
import { sceneStore, useScene } from "@/scene/store";
import { getWorldHeightField } from "@/scene/terrain";

const DIRT = "#9c8259";

/** A dirt path as a ribbon draped over the terrain between its endpoints. */
export function PathRibbon({ node }: { node: SceneNode }) {
  // Re-derive when anything the path depends on changes (endpoints, terrain, lakes).
  const key = useScene((s) => {
    const p = node.procedural?.params ?? {};
    const ends = [p.from, p.to].map((ref) => {
      const n = typeof ref === "string" ? s.world.nodes[ref] : undefined;
      return n ? n.transform.position.join(",") : String(ref);
    });
    const t = s.world.environment.terrain;
    return `${ends.join("|")}|${t.type}${t.seed}${t.height}|${Object.keys(s.world.nodes).length}`;
  });

  const geometry = useMemo(() => {
    void key;
    const world = sceneStore.getState().world;
    return ribbon(world, node);
  }, [key, node]);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        color={DIRT}
        roughness={1}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
}

function ribbon(world: Parameters<typeof pathPolyline>[0], node: SceneNode): BufferGeometry {
  const points = pathPolyline(world, node);
  const half = pathWidth(node) / 2;
  const heightAt = getWorldHeightField(world);
  const positions = new Float32Array(points.length * 2 * 3);
  const index: number[] = [];

  points.forEach((p, i) => {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    // Slightly narrower at the ends so it doesn't look cut off.
    const w = half * (i === 0 || i === points.length - 1 ? 0.7 : 1);
    for (const [k, side] of [
      [0, 1],
      [1, -1],
    ] as const) {
      const x = p.x + nx * w * side;
      const z = p.z + nz * w * side;
      positions.set([x, heightAt(x, z) + 0.04, z], (i * 2 + k) * 3);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
