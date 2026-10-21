"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { usePerf } from "./perf";

const SAMPLE_MS = 500;

/** Counts frames and reads renderer stats; publishes them to usePerf. */
export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const sample = useRef({ frames: 0, since: 0 });

  useFrame(() => {
    const s = sample.current;
    const now = performance.now();
    if (s.since === 0) s.since = now;
    s.frames++;
    if (now - s.since >= SAMPLE_MS) {
      usePerf.setState({
        fps: Math.round((s.frames * 1000) / (now - s.since)),
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        dpr: gl.getPixelRatio(),
      });
      s.frames = 0;
      s.since = now;
    }
  });
  return null;
}
