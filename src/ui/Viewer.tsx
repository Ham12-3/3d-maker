"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useDirector } from "@/render/camera/director";
import type { World } from "@/scene/schema";
import { sceneStore } from "@/scene/store";
import { Credits } from "./Credits";
import { HeaderButton } from "./AppHeader";
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
export function Viewer({ world, remixHref }: { world: World; remixHref: string }) {
  useLoadWorld(world);
  const [directing, setDirecting] = useState(false);
  const recording = useDirector((s) => s.recording);

  return (
    // Same chrome as the editor: top bar and a framed preview (no chat).
    <main className="bg-shell flex h-dvh w-full flex-col">
      <header className="relative z-30 flex h-12 shrink-0 items-center gap-2 px-3">
        <span className="brand-gradient grid size-7 shrink-0 place-items-center rounded-lg text-sm font-bold text-white">
          S
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white/90">{world.title}</div>
          <div className="truncate text-[11px] text-white/45">Built by voice with Speakworld</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {recording && <RecordingBadge startedAt={recording.startedAt} />}
          <HeaderButton active={directing} onClick={() => setDirecting((d) => !d)}>
            Director
          </HeaderButton>
          <Credits />
          <a
            href={remixHref}
            title="Open a copy in the editor and keep building"
            className="brand-gradient rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_2px_12px_rgb(255_77_141/0.35)] hover:brightness-110"
          >
            Remix
          </a>
        </div>
        {directing && (
          <div className="absolute top-full right-3 mt-1">
            <DirectorPanel onClose={() => setDirecting(false)} />
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 px-2 pb-2">
        <section
          aria-label="Preview"
          className="relative h-full overflow-hidden rounded-xl border border-white/10 bg-[#0b0d12]"
        >
          <StageFrame>
            <Stage />
          </StageFrame>
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1.5 text-[11px] text-white/60 backdrop-blur">
            Drag to look around · scroll to zoom
          </div>
        </section>
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
