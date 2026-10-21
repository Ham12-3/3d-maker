"use client";

import { useMemo } from "react";
import { BufferAttribute, PlaneGeometry } from "three";
import { createNoise2D } from "@/lib/noise";
import { useInteraction } from "@/scene/interaction";
import type { Environment } from "@/scene/schema";
import { TERRAIN_SIZE, getHeightField } from "@/scene/terrain";

const SEGMENTS = 160;

export function Terrain({ terrain }: { terrain: Environment["terrain"] }) {
  const { type, seed, height, color } = terrain;
  const setPointer = useInteraction((s) => s.setPointer);
  const select = useInteraction((s) => s.select);

  const geometry = useMemo(() => buildGeometry({ type, seed, height }), [type, seed, height]);

  return (
    <mesh
      geometry={geometry}
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        select(null);
        setPointer([e.point.x, e.point.y, e.point.z]);
      }}
    >
      <meshStandardMaterial color={color} vertexColors flatShading roughness={0.95} />
    </mesh>
  );
}

function buildGeometry(params: Pick<Environment["terrain"], "type" | "seed" | "height">) {
  const heightAt = getHeightField(params);
  const tint = createNoise2D(params.seed + 1);
  const geometry = new PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
  // Lie flat: local (x, y) becomes world (x, -z).
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, heightAt(x, z));
    // Grey-scale variation, multiplied by the material colour.
    const shade = 0.9 + 0.1 * tint(x / 9, z / 9);
    colors.set([shade, shade, shade], i * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
