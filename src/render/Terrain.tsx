"use client";

import { useMemo } from "react";
import { BufferAttribute, Color, PlaneGeometry } from "three";
import { createNoise2D } from "@/lib/noise";
import { useInteraction } from "@/scene/interaction";
import type { Environment } from "@/scene/schema";
import { SHORE_FACTOR, TERRAIN_SIZE, carveLakes, getHeightField, type Lake } from "@/scene/terrain";

const SEGMENTS = 160;
const SAND = new Color("#c8b48a");
const LAKE_BED = new Color("#5d6b4f");

export function Terrain({ terrain, lakes }: { terrain: Environment["terrain"]; lakes: Lake[] }) {
  const { type, seed, height, color } = terrain;
  const setPointer = useInteraction((s) => s.setPointer);
  const select = useInteraction((s) => s.select);

  const geometry = useMemo(
    () => buildGeometry({ type, seed, height }, lakes, color),
    [type, seed, height, lakes, color],
  );

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
      <meshStandardMaterial vertexColors flatShading roughness={0.95} />
    </mesh>
  );
}

function buildGeometry(
  params: Pick<Environment["terrain"], "type" | "seed" | "height">,
  lakes: Lake[],
  color: string,
) {
  const heightAt = carveLakes(getHeightField(params), lakes);
  const tint = createNoise2D(params.seed + 1);
  const grass = new Color(color);
  const c = new Color();
  const geometry = new PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
  // Lie flat: local (x, y) becomes world (x, -z).
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, heightAt(x, z));

    c.copy(grass).multiplyScalar(0.9 + 0.1 * tint(x / 9, z / 9));
    // Sandy shore and a darker lake bed near any lake.
    for (const lake of lakes) {
      const t = Math.hypot(x - lake.x, z - lake.z) / lake.radius;
      if (t < 0.9) c.lerp(LAKE_BED, 0.8);
      else if (t < SHORE_FACTOR * 0.85) c.lerp(SAND, 0.75);
    }
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
