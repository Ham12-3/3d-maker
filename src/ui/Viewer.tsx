"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useDirector } from "@/render/camera/director";
import type { World } from "@/scene/schema";
import { sceneStore } from "@/scene/store";
import { Credits } from "./Credits";
import { DirectorPanel, RecordingBadge } from "./DirectorPanel";
import { StageFrame } from "./StageFrame";

const Stage = dynamic(() => import("@/render/Stage"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#0b0d12]" />,
});

/**
 * Read-only view of a shared world: look around, record a reel, or remix it
 * in the editor. No command bar, no agent.
 */
export function Viewer({ id, world }: { id: string; world: World }) {
  useLoadWorld(world);
  const [directing, setDirecting] = useState(false);
  const recording = useDirector((s) => s.recording);

  return (
    <main className="relative h-dvh w-full">
      <StageFrame>
        <Stage />
      </StageFrame>
      <div className="glass absolute top-4 left-4 px-4 py-2">
        <div className="text-sm font-medium tracking-tight">{world.title}</div>
        <div className="text-[11px] text-white/50">Built by voice with Speakworld</div>
      </div>
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => setDirecting((d) => !d)}
            aria-expanded={directing}
            className={`glass px-3 py-1.5 text-xs ${directing ? "text-sky-200" : "text-white/80 hover:text-white"}`}
          >
            Director
          </button>
          <a
            href={`/?w=${id}`}
            className="glass px-3 py-1.5 text-xs text-white/80 hover:text-white"
            title="Open a copy in the editor and keep building"
          >
            Remix
          </a>
          <Credits />
        </div>
        {recording && <RecordingBadge startedAt={recording.startedAt} />}
        {directing && <DirectorPanel onClose={() => setDirecting(false)} />}
      </div>
      <div className="glass pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1.5 text-[11px] text-white/55">
        Drag to look around · scroll to zoom
      </div>
    </main>
  );
}

/**
 * Put the shared world in the store before the 3D view mounts (the Stage
 * reads the starting camera once). Browser only: the store is a module
 * singleton, so the server must not write to it.
 */
function useLoadWorld(world: World) {
  useState(() => {
    if (typeof window === "undefined") return null;
    sceneStore.getState().replaceWorld(world);
    useDirector.getState().setLive(world.camera);
    return null;
  });
}
