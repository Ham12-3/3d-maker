"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type { Object3D } from "three";

/**
 * GLB export of what the world renders (terrain, water, models, instanced
 * nature), without sky, weather, helpers or shader-only effects. Like the
 * capture bridge, a component inside the Canvas registers the function.
 */

export const EXPORT_ROOT = "world-export";
let exporter: (() => Promise<Blob>) | null = null;

export async function exportGlb(): Promise<Blob> {
  if (!exporter) throw new Error("The 3D view is not ready yet");
  return exporter();
}

export function ExportBridge() {
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    exporter = async () => {
      const root = scene.getObjectByName(EXPORT_ROOT);
      if (!root) throw new Error("Nothing to export");
      const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
      const hidden = hideUnexportable(root);
      const restoreTextures = stripDataTextures(root);
      try {
        const glb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
        return new Blob([glb as ArrayBuffer], { type: "model/gltf-binary" });
      } finally {
        for (const o of hidden) o.visible = true;
        restoreTextures();
      }
    };
    return () => {
      exporter = null;
    };
  }, [scene]);

  return null;
}

/**
 * Generated textures (the water's ripple normal map) are raw pixel data the
 * exporter can't draw into an image; drop them for the export, then put back.
 */
function stripDataTextures(root: Object3D): () => void {
  const removed: { material: Record<string, unknown>; key: string; texture: unknown }[] = [];
  root.traverse((o) => {
    type Material = Record<string, unknown>;
    const materials = ([] as Material[]).concat((o as { material?: Material }).material ?? []);
    for (const m of materials) {
      for (const [key, value] of Object.entries(m)) {
        if ((value as { isDataTexture?: boolean } | null)?.isDataTexture) {
          removed.push({ material: m, key, texture: value });
          m[key] = null;
        }
      }
    }
  });
  return () => {
    for (const r of removed) r.material[r.key] = r.texture;
  };
}

/** Points, sprites, DOM labels and custom shaders have no glTF equivalent. */
function hideUnexportable(root: Object3D): Object3D[] {
  const hidden: Object3D[] = [];
  root.traverse((o) => {
    const material = (o as { material?: { isShaderMaterial?: boolean } }).material;
    const skip =
      o.userData.noExport === true ||
      (o as { isPoints?: boolean }).isPoints ||
      (o as { isSprite?: boolean }).isSprite ||
      material?.isShaderMaterial;
    if (skip && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  });
  return hidden;
}
