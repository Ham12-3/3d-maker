"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import { useInteraction } from "@/scene/interaction";
import { sceneStore } from "@/scene/store";
import { CameraRig } from "./camera/CameraRig";
import { World } from "./World";

/** The full-screen 3D canvas. Client only (loaded with ssr: false). */
export default function Stage() {
  // Read once: the camera is user-driven after mount; Director mode takes over later.
  const { position, target, fov } = sceneStore.getState().world.camera;

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position, fov, near: 0.1, far: 5000 }}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }}
      onPointerMissed={() => useInteraction.getState().select(null)}
    >
      <World />
      <CameraRig />
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
