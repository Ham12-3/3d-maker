"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useInteraction } from "@/scene/interaction";
import { sceneStore } from "@/scene/store";
import { useVoice } from "@/voice/useVoice";
import { CommandBar } from "./CommandBar";
import { Credits } from "./Credits";
import { DevOverlay } from "./DevOverlay";
import { DevPanel } from "./DevPanel";
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

  return (
    <main className="relative h-dvh w-full">
      <Stage />
      <Toolbar />
      <CommandBar />
      {process.env.NODE_ENV === "development" && (
        <>
          <DevPanel />
          <DevOverlay />
        </>
      )}
      <Credits />
    </main>
  );
}
