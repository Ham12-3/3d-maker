"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useInteraction } from "@/scene/interaction";
import { sceneStore } from "@/scene/store";
import { fetchSharedWorld, openInEditor } from "@/share/client";
import { decodeWorld, worldFromHash } from "@/share/link";
import { useVoice } from "@/voice/useVoice";
import { CommandBar } from "./CommandBar";
import { TopBar } from "./TopBar";
import { DevOverlay } from "./DevOverlay";
import { DevPanel } from "./DevPanel";
import { StageFrame } from "./StageFrame";
import { Toolbar } from "./Toolbar";
import { useShortcuts } from "./useShortcuts";

const Stage = dynamic(() => import("@/render/Stage"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#0b0d12]" />,
});

export function App() {
  useShortcuts();
  useVoice();

  useEffect(() => {
    // Handy for manual edits from the console: __scene.getState().edit(...)
    if (process.env.NODE_ENV === "development") {
      Object.assign(window, { __scene: sceneStore, __interaction: useInteraction });
    }
  }, []);

  // "Remix" from a share page opens /?w=<id> (stored) or /#world=... (in
  // the link): load that world to edit.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("w");
    const packed = worldFromHash(location.hash);
    const load = id
      ? fetchSharedWorld(id)
      : packed
        ? decodeWorld(packed).then((world) => ({ world }))
        : null;
    load
      ?.then((loaded) => {
        openInEditor(loaded);
        if (packed) history.replaceState(null, "", "/");
      })
      .catch((err: Error) => console.warn(`[share] could not open the world: ${err.message}`));
  }, []);

  return (
    <main className="relative h-dvh w-full">
      <StageFrame>
        <Stage />
      </StageFrame>
      <Toolbar />
      <CommandBar />
      {process.env.NODE_ENV === "development" && (
        <>
          <DevPanel />
          <DevOverlay />
        </>
      )}
      <TopBar />
    </main>
  );
}
