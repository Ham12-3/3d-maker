"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  NormalBlending,
  ShaderMaterial,
  type Points,
} from "three";
import { createRng } from "@/lib/random";
import type { Environment } from "@/scene/schema";

/**
 * Rain or snow in a box that follows the camera. All motion happens in the
 * vertex shader (one time uniform), so thousands of drops cost one draw call.
 */

const BOX = { x: 70, y: 32, z: 70 };

const LOOKS = {
  rain: { count: 3500, speed: 22, size: 1.6, color: [0.75, 0.82, 0.95], opacity: 0.55, drift: 0.4 },
  snow: { count: 2500, speed: 1.6, size: 5.5, color: [1, 1, 1], opacity: 0.9, drift: 1.2 },
} as const;

export function Weather({ weather }: { weather: Environment["weather"] }) {
  if (weather === "none") return null;
  return <Precipitation key={weather} kind={weather} />;
}

function Precipitation({ kind }: { kind: "rain" | "snow" }) {
  const look = LOOKS[kind];
  const camera = useThree((s) => s.camera);
  const points = useRef<Points<BufferGeometry, ShaderMaterial>>(null);

  const geometry = useMemo(() => {
    const rng = createRng(kind === "rain" ? 3 : 5);
    const pos = new Float32Array(look.count * 3);
    const phase = new Float32Array(look.count);
    for (let i = 0; i < look.count; i++) {
      pos.set([(rng() - 0.5) * BOX.x, rng() * BOX.y, (rng() - 0.5) * BOX.z], i * 3);
      phase[i] = rng() * 100;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("phase", new BufferAttribute(phase, 1));
    return g;
  }, [kind, look.count]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: kind === "rain" ? AdditiveBlending : NormalBlending,
        uniforms: {
          time: { value: 0 },
          height: { value: BOX.y },
          speed: { value: look.speed },
          drift: { value: look.drift },
          size: { value: look.size },
          tint: { value: look.color },
          alpha: { value: look.opacity },
          rain: { value: kind === "rain" ? 1 : 0 },
        },
        vertexShader: /* glsl */ `
          attribute float phase;
          uniform float time, height, speed, drift, size;
          void main() {
            vec3 p = position;
            p.y = mod(p.y - time * speed + phase, height) - height * 0.25;
            p.x += sin(time * 0.7 + phase) * drift;
            p.z += cos(time * 0.5 + phase * 1.3) * drift;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = size * 40.0 / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 tint;
          uniform float alpha, rain;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            // Rain: a thin vertical streak. Snow: a soft round flake.
            float d = rain > 0.5 ? length(vec2(c.x * 6.0, c.y)) : length(c);
            float a = smoothstep(0.5, 0.0, d) * alpha;
            if (a < 0.01) discard;
            gl_FragColor = vec4(tint, a);
          }`,
      }),
    [kind, look],
  );

  useFrame(({ clock }) => {
    const p = points.current;
    if (!p) return;
    p.material.uniforms.time!.value = clock.elapsedTime;
    // Follow the camera in steps, so drops don't slide with every small move.
    p.position.set(
      Math.round(camera.position.x / 4) * 4,
      camera.position.y - 6,
      Math.round(camera.position.z / 4) * 4,
    );
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}
