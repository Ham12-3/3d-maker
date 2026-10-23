"use client";

import { useDirector } from "@/render/camera/director";

/**
 * Holds the 3D canvas: full screen, or a centred 9:16 reel frame in Director
 * mode. The element tree never changes between the two (only classes), so
 * the Canvas is not remounted when the frame switches.
 */
export function StageFrame({ children }: { children: React.ReactNode }) {
  const vertical = useDirector((s) => s.frame === "vertical");
  return (
    <div className={`absolute inset-0 ${vertical ? "grid place-items-center bg-[#05060a]" : ""}`}>
      <div
        data-stage-frame
        className={vertical ? "relative overflow-hidden rounded-xl" : "absolute inset-0"}
        style={
          vertical
            ? { height: "min(92dvh, calc(92vw * 16 / 9))", aspectRatio: "9 / 16" }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
