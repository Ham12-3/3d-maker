"use client";

import { useFrame } from "@react-three/fiber";
import { useDirector } from "./director";
import { recordingSink } from "./recording";

/**
 * While recording, render each frame ourselves (priority 1 takes over R3F's
 * render) and copy it into the recording canvas in the same task, so it
 * works without preserveDrawingBuffer.
 */
export function RecordFrames() {
  const recording = useDirector((s) => s.recording);
  return recording ? <Copier /> : null;
}

function Copier() {
  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera);
    const sink = recordingSink();
    if (!sink) return;
    const src = gl.domElement;
    const { width, height } = sink.canvas;
    // Cover-crop: the frame is 9:16 already, so this only trims rounding.
    const scale = Math.max(width / src.width, height / src.height);
    const sw = width / scale;
    const sh = height / scale;
    sink.ctx.drawImage(
      src,
      (src.width - sw) / 2,
      (src.height - sh) / 2,
      sw,
      sh,
      0,
      0,
      width,
      height,
    );
  }, 1);
  return null;
}
