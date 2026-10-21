"use client";

import { Sky, Stars } from "@react-three/drei";
import { useMemo } from "react";
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

/** Sky dome, sun, ambient light, stars and fog, all driven by the environment. */
export function SkySystem({ env }: { env: Environment }) {
  const look = SKY_LOOKS[env.sky];
  const dir = useMemo(() => sunDirection(env.timeOfDay), [env.timeOfDay]);
  const day = daylight(env.timeOfDay);
  const sunPosition: [number, number, number] = [
    dir[0] * SUN_DISTANCE,
    dir[1] * SUN_DISTANCE,
    dir[2] * SUN_DISTANCE,
  ];

  return (
    <>
      <Sky
        distance={4500}
        sunPosition={sunPosition}
        turbidity={look.turbidity}
        rayleigh={look.rayleigh}
        mieCoefficient={look.mieCoefficient}
        mieDirectionalG={look.mieG}
      />
      {env.stars && <Stars radius={180} depth={60} count={4000} factor={4} fade speed={0.5} />}

      <directionalLight
        position={sunPosition}
        intensity={env.sun.intensity * day}
        color={env.sun.color}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-far={200}
      />
      <hemisphereLight
        color={env.ambient.color}
        groundColor={env.terrain.color}
        intensity={env.ambient.intensity * (0.4 + 0.6 * day)}
      />

      {env.fog.enabled && <fogExp2 attach="fog" args={[env.fog.color, env.fog.density]} />}
    </>
  );
}
