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

export type CaptureOptions = {
  /** Output width cap in pixels (default 1024). */
  maxWidth?: number;
  /** Crop the centre of the view to this width/height ratio (e.g. 1200/630 for link previews). */
  aspect?: number;
};

let capture: ((opts: CaptureOptions) => ToolImage) | null = null;

export async function captureView(opts: CaptureOptions = {}): Promise<ToolImage | null> {
  return capture ? capture(opts) : null;
}

export function CaptureBridge() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    capture = ({ maxWidth = 1024, aspect }) => {
      gl.render(scene, camera);
      const src = gl.domElement;
      // Source rectangle: the whole frame, or its centre cropped to `aspect`.
      let sw = src.width;
      let sh = src.height;
      if (aspect) {
        if (sw / sh > aspect) sw = Math.round(sh * aspect);
        else sh = Math.round(sw / aspect);
      }
      const k = Math.min(1, maxWidth / sw);
      const out = document.createElement("canvas");
      out.width = Math.round(sw * k);
      out.height = Math.round(sh * k);
      out
        .getContext("2d")!
        .drawImage(
          src,
          (src.width - sw) / 2,
          (src.height - sh) / 2,
          sw,
          sh,
          0,
          0,
          out.width,
          out.height,
        );
      const data = out.toDataURL("image/jpeg", 0.82).split(",")[1]!;
      return { mediaType: "image/jpeg", data, width: out.width, height: out.height };
    };
    return () => {
      capture = null;
    };
  }, [gl, scene, camera]);

  return null;
}
