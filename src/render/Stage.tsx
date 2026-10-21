"use client";

import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useState } from "react";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import { useInteraction } from "@/scene/interaction";
import { sceneStore } from "@/scene/store";
import { CameraRig } from "./camera/CameraRig";
import { CaptureBridge } from "./capture";
import { PerfProbe } from "./PerfProbe";
import { World } from "./World";

const MAX_DPR = 1.75;
const MIN_DPR = 0.75;

/** The full-screen 3D canvas. Client only (loaded with ssr: false). */
export default function Stage() {
  // Read once: the camera is user-driven after mount; Director mode takes over later.
  const { position, target, fov } = sceneStore.getState().world.camera;
  const [dpr, setDpr] = useState(() =>
    typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio, MAX_DPR),
  );

  return (
    <Canvas
      shadows
      dpr={dpr}
      camera={{ position, fov, near: 0.1, far: 5000 }}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }}
      onPointerMissed={() => useInteraction.getState().select(null)}
    >
      {/* Integrated GPUs: trade resolution for frame rate when it dips, and back. */}
      <PerformanceMonitor
        onDecline={() => setDpr((d) => Math.max(MIN_DPR, +(d - 0.25).toFixed(2)))}
        onIncline={() => setDpr((d) => Math.min(MAX_DPR, +(d + 0.25).toFixed(2)))}
      />
      <World />
      <CameraRig />
      <PerfProbe />
      <CaptureBridge />
      <OrbitControls
        makeDefault
        target={target}
        enableDamping
        maxPolarAngle={Math.PI / 2 - 0.05}
        minDistance={2}
        maxDistance={150}
      />
    </Canvas>
  );
}
