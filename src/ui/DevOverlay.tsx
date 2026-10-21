"use client";

import { useAgentStatus } from "@/agent/status";
import { usePerf } from "@/render/perf";

/** Dev-only stats: frame rate, draw calls, triangles, and the last command's timings. */
export function DevOverlay() {
  const { fps, calls, triangles, dpr } = usePerf();
  const last = useAgentStatus((s) => s.lastTurn);
  const colour = fps >= 55 ? "text-emerald-300" : fps >= 40 ? "text-amber-300" : "text-red-300";

  return (
    <div className="glass pointer-events-none absolute top-16 left-4 px-3 py-2 font-mono text-[10px] leading-4 text-white/60">
      <div>
        <span className={colour}>{fps} fps</span> · {calls} calls · {(triangles / 1000).toFixed(0)}k
        tris · dpr {dpr.toFixed(2)}
      </div>
      {last && (
        <div>
          last: first change {last.firstChangeMs?.toFixed(0) ?? "-"}ms · total{" "}
          {last.totalMs.toFixed(0)}ms · {last.toolCalls} tools · {last.iterations} trips
          {last.judge?.fixed.length ? ` · judge fixed ${last.judge.fixed.length}` : ""}
        </div>
      )}
    </div>
  );
}
