"use client";

import { useMemo } from "react";
import { BufferAttribute, Color, PlaneGeometry } from "three";
import { createNoise2D } from "@/lib/noise";
import { useInteraction } from "@/scene/interaction";
import type { Environment } from "@/scene/schema";
import { sceneStore } from "@/scene/store";
import { TERRAIN_SIZE, getWorldHeightField, nearestWater, waterBodies } from "@/scene/terrain";

const SEGMENTS = 160;
const SAND = new Color("#c8b48a");
const WATER_BED = new Color("#5d6b4f");
/** Metres of sandy bank beyond the water's edge. */
const BANK = 2.5;

/**
 * Low-poly terrain from the world's height field (lakes and rivers carved in).
 * `waterKey` changes only when water changes, so adding objects doesn't
 * rebuild the 26k-vertex mesh.
 */
export function Terrain({
  terrain,
  waterKey,
}: {
  terrain: Environment["terrain"];
  waterKey: string;
}) {
  const { type, seed, height, color } = terrain;
  const setPointer = useInteraction((s) => s.setPointer);
  const select = useInteraction((s) => s.select);

  const geometry = useMemo(() => {
    void waterKey;
    void type;
    void height;
    return buildGeometry(seed, color);
  }, [type, seed, height, color, waterKey]);

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

function buildGeometry(seed: number, color: string) {
  const world = sceneStore.getState().world;
  const heightAt = getWorldHeightField(world);
  const water = waterBodies(world);
  const hasWater = water.lakes.length + water.rivers.length > 0;
  const tint = createNoise2D(seed + 1);
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
    // Darker bed under water, sandy banks around it.
    const hit = hasWater ? nearestWater(water, x, z) : null;
    if (hit && hit.distance < -1) c.lerp(WATER_BED, 0.8);
    else if (hit && hit.distance < BANK) c.lerp(SAND, 0.75);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
