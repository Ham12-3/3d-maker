"use client";

import { create } from "zustand";

/** Rendering stats for the dev overlay, sampled twice a second inside the Canvas. */
type PerfState = { fps: number; calls: number; triangles: number; dpr: number };

export const usePerf = create<PerfState>()(() => ({ fps: 0, calls: 0, triangles: 0, dpr: 1 }));
