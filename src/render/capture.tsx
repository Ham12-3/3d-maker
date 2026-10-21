"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type { ToolImage } from "@/agent/tools/types";

/**
 * Screenshots for visual critique. A bridge component inside the Canvas
 * registers a capture function; the agent calls `captureView()` from outside.
 * It renders a fresh frame and copies it in the same task, so it works
 * without preserveDrawingBuffer (and even when the tab is in the background).
 */

const MAX_WIDTH = 1024;
let capture: (() => ToolImage) | null = null;

export async function captureView(): Promise<ToolImage | null> {
  return capture ? capture() : null;
}

export function CaptureBridge() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    capture = () => {
      gl.render(scene, camera);
      const src = gl.domElement;
      const k = Math.min(1, MAX_WIDTH / src.width);
      const out = document.createElement("canvas");
      out.width = Math.round(src.width * k);
      out.height = Math.round(src.height * k);
      out.getContext("2d")!.drawImage(src, 0, 0, out.width, out.height);
      const data = out.toDataURL("image/jpeg", 0.82).split(",")[1]!;
      return { mediaType: "image/jpeg", data, width: out.width, height: out.height };
    };
    return () => {
      capture = null;
    };
  }, [gl, scene, camera]);

  return null;
}
