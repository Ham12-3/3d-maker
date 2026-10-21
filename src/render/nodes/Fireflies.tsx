"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from "three";
import { createRng } from "@/lib/random";
import { daylight } from "@/render/sun";
import type { SceneNode } from "@/scene/schema";
import { sceneStore } from "@/scene/store";
import { getWorldHeightField } from "@/scene/terrain";

const MAX = 400;

/** Drifting, blinking points of light. Faint by day, bright at night. */
export function Fireflies({ node }: { node: SceneNode }) {
  const params = node.procedural?.params ?? {};
  const count = Math.min(MAX, Math.max(1, Number(params.count ?? 120)));
  const radius = Number(params.radius ?? node.transform.scale[0] / 2);
  const seed = node.procedural?.seed ?? 1;
  const [cx, , cz] = node.transform.position;
  const color = String(params.color ?? "#ffe27a");

  const geometry = useMemo(() => {
    const rng = createRng(seed);
    const heightAt = getWorldHeightField(sceneStore.getState().world);
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(rng()) * radius;
      const a = rng() * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      pos.set([x, heightAt(x, z) + 0.4 + rng() * 2.6, z], i * 3);
      phase[i] = rng() * 100;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("phase", new BufferAttribute(phase, 1));
    return g;
  }, [count, radius, seed, cx, cz]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { time: { value: 0 }, glow: { value: 1 }, tint: { value: hexToVec(color) } },
        vertexShader: /* glsl */ `
          attribute float phase;
          uniform float time;
          varying float vBlink;
          void main() {
            vec3 p = position;
            float t = time * 0.35 + phase;
            p += vec3(sin(t * 1.3) * 0.8, sin(t * 0.9 + 1.7) * 0.35, cos(t * 1.1) * 0.8);
            vBlink = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(time * 2.2 + phase * 3.0), 3.0);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = 26.0 / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float glow;
          uniform vec3 tint;
          varying float vBlink;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            a = a * a * vBlink * glow;
            gl_FragColor = vec4(tint * (1.0 + a), a);
          }`,
      }),
    [color],
  );

  const points = useRef<Points<BufferGeometry, ShaderMaterial>>(null);
  useFrame(({ clock }) => {
    const uniforms = points.current?.material.uniforms;
    if (!uniforms) return;
    uniforms.time!.value = clock.elapsedTime;
    const day = daylight(sceneStore.getState().world.environment.timeOfDay);
    uniforms.glow!.value = 1.15 - day * 0.85;
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}

function hexToVec(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
