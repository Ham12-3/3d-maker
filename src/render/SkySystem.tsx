"use client";

import { Sky, Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState, type ComponentRef } from "react";
import { Color, type DirectionalLight, type FogExp2, type HemisphereLight } from "three";
import type { Environment } from "@/scene/schema";
import { daylight, sunDirection } from "./sun";

type SkyLook = { turbidity: number; rayleigh: number; mieCoefficient: number; mieG: number };

const SKY_LOOKS: Record<Environment["sky"], SkyLook> = {
  clear: { turbidity: 6, rayleigh: 1, mieCoefficient: 0.005, mieG: 0.8 },
  sunset: { turbidity: 10, rayleigh: 3, mieCoefficient: 0.005, mieG: 0.95 },
  overcast: { turbidity: 20, rayleigh: 0.4, mieCoefficient: 0.05, mieG: 0.6 },
  night: { turbidity: 2, rayleigh: 0.2, mieCoefficient: 0.002, mieG: 0.7 },
  storm: { turbidity: 20, rayleigh: 0.2, mieCoefficient: 0.1, mieG: 0.5 },
  dreamy: { turbidity: 4, rayleigh: 4, mieCoefficient: 0.01, mieG: 0.9 },
};

const SUN_DISTANCE = 80;
/** Exponential easing rate: ~99% of the way in 1.5 s. */
const EASE_RATE = 3;
const MOON_COLOR = "#8fa8ff";

/** Mutable "current" values that ease towards the environment each frame. */
type Animated = {
  time: number;
  look: SkyLook;
  sunIntensity: number;
  sunColor: Color;
  ambientIntensity: number;
  ambientColor: Color;
  groundColor: Color;
  fogColor: Color;
  fogDensity: number;
};

function snapshot(env: Environment): Animated {
  return {
    time: env.timeOfDay,
    look: { ...SKY_LOOKS[env.sky] },
    sunIntensity: env.sun.intensity,
    sunColor: new Color(env.sun.color),
    ambientIntensity: env.ambient.intensity,
    ambientColor: new Color(env.ambient.color),
    groundColor: new Color(env.terrain.color),
    fogColor: new Color(env.fog.color),
    fogDensity: env.fog.enabled ? env.fog.density : 0,
  };
}

/**
 * Sky dome, sun, moon, ambient light, stars and fog. Every environment change
 * eases smoothly instead of snapping, and runs imperatively in useFrame so
 * the tween costs no React re-renders.
 */
export function SkySystem({ env }: { env: Environment }) {
  // Starting values for the JSX below; everything after mount is driven by useFrame.
  const [initialEnv] = useState(env);
  const initial = useMemo(() => snapshot(initialEnv), [initialEnv]);
  const target = useMemo(() => snapshot(env), [env]);
  const current = useRef<Animated | null>(null);

  const sky = useRef<ComponentRef<typeof Sky>>(null);
  const sun = useRef<DirectionalLight>(null);
  const moon = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const fog = useRef<FogExp2>(null);

  useFrame((_, dt) => {
    const c = (current.current ??= snapshot(initialEnv));
    const t = target;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * EASE_RATE);
    const ease = (from: number, to: number) => from + (to - from) * k;

    // Take the short way round midnight (22h -> 2h goes forwards).
    let dTime = t.time - c.time;
    if (dTime > 12) dTime -= 24;
    if (dTime < -12) dTime += 24;
    c.time = (((c.time + dTime * k) % 24) + 24) % 24;

    c.look.turbidity = ease(c.look.turbidity, t.look.turbidity);
    c.look.rayleigh = ease(c.look.rayleigh, t.look.rayleigh);
    c.look.mieCoefficient = ease(c.look.mieCoefficient, t.look.mieCoefficient);
    c.look.mieG = ease(c.look.mieG, t.look.mieG);
    c.sunIntensity = ease(c.sunIntensity, t.sunIntensity);
    c.ambientIntensity = ease(c.ambientIntensity, t.ambientIntensity);
    c.fogDensity = ease(c.fogDensity, t.fogDensity);
    c.sunColor.lerp(t.sunColor, k);
    c.ambientColor.lerp(t.ambientColor, k);
    c.groundColor.lerp(t.groundColor, k);
    c.fogColor.lerp(t.fogColor, k);

    const dir = sunDirection(c.time);
    const day = daylight(c.time);

    const uniforms = sky.current?.material.uniforms;
    if (uniforms) {
      uniforms.sunPosition!.value.set(dir[0], dir[1], dir[2]);
      uniforms.turbidity!.value = c.look.turbidity;
      uniforms.rayleigh!.value = c.look.rayleigh;
      uniforms.mieCoefficient!.value = c.look.mieCoefficient;
      uniforms.mieDirectionalG!.value = c.look.mieG;
    }
    if (sun.current) {
      sun.current.position.set(dir[0] * SUN_DISTANCE, dir[1] * SUN_DISTANCE, dir[2] * SUN_DISTANCE);
      sun.current.intensity = c.sunIntensity * day;
      sun.current.color.copy(c.sunColor);
    }
    if (moon.current) moon.current.intensity = 0.45 * (1 - day);
    if (hemi.current) {
      hemi.current.intensity = c.ambientIntensity * (0.4 + 0.6 * day);
      hemi.current.color.copy(c.ambientColor);
      hemi.current.groundColor.copy(c.groundColor);
    }
    if (fog.current) {
      fog.current.color.copy(c.fogColor);
      fog.current.density = c.fogDensity;
    }
  });

  const initialDir = sunDirection(initial.time);
  return (
    <>
      {/* Props are only the starting values; useFrame drives the uniforms from here. */}
      <Sky
        ref={sky}
        distance={4500}
        sunPosition={initialDir}
        turbidity={initial.look.turbidity}
        rayleigh={initial.look.rayleigh}
        mieCoefficient={initial.look.mieCoefficient}
        mieDirectionalG={initial.look.mieG}
      />
      {env.stars && <Stars radius={180} depth={60} count={4000} factor={4} fade speed={0.5} />}

      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-far={200}
      />
      <directionalLight ref={moon} position={[-30, 60, 20]} color={MOON_COLOR} intensity={0} />
      <hemisphereLight ref={hemi} />
      <fogExp2 ref={fog} attach="fog" args={[initial.fogColor.getHex(), initial.fogDensity]} />
    </>
  );
}
