"use client";

import { useFrame } from "@react-three/fiber";
import { DataTexture, RepeatWrapping, RGBAFormat, type Texture } from "three";
import { createNoise2D } from "@/lib/noise";

/** Shared look for every water surface: lakes, rivers and the sea. */

export const DEFAULT_WATER = "#3f7f93";

export function WaterMaterial({ color = DEFAULT_WATER }: { color?: string }) {
  // Scroll as a function of the clock, not an increment, so several water
  // bodies sharing the texture don't speed it up.
  useFrame(({ clock }) => scrollRipples(clock.elapsedTime));
  return (
    <meshStandardMaterial
      color={color}
      roughness={0.12}
      metalness={0.15}
      normalMap={rippleTexture()}
      normalScale={[0.35, 0.35]}
      transparent
      opacity={0.88}
    />
  );
}

let shared: Texture | null = null;

function scrollRipples(seconds: number) {
  rippleTexture().offset.set(seconds * 0.012, seconds * 0.008);
}

/** Tileable ripple normal map built from noise once. */
function rippleTexture(): Texture {
  if (shared) return shared;
  const size = 128;
  const noise = createNoise2D(7);
  const data = new Uint8Array(size * size * 4);
  const h = (x: number, y: number) => {
    // Sample on a torus so the texture tiles seamlessly.
    const a = (x / size) * Math.PI * 2;
    const b = (y / size) * Math.PI * 2;
    return (
      noise(Math.cos(a) * 2 + Math.cos(b) * 0.5, Math.sin(a) * 2 + Math.sin(b) * 0.5) * 0.5 +
      noise(Math.cos(b) * 3, Math.sin(b) * 3) * 0.5
    );
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round((0.5 - dx * 1.5) * 255);
      data[i + 1] = Math.round((0.5 - dy * 1.5) * 255);
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.needsUpdate = true;
  shared = texture;
  return texture;
}
