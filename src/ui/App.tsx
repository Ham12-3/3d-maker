"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useInteraction } from "@/scene/interaction";
import { sceneStore } from "@/scene/store";
import { fetchSharedWorld, openInEditor } from "@/share/client";
import { decodeWorld, worldFromHash } from "@/share/link";
import { useVoice } from "@/voice/useVoice";
import { AppHeader } from "./AppHeader";
import { ChatPanel } from "./ChatPanel";
import { DevOverlay } from "./DevOverlay";
import { DevPanel } from "./DevPanel";
import { useLayout } from "./layout";
import { StageFrame } from "./StageFrame";
import { useShortcuts } from "./useShortcuts";

const Stage = dynamic(() => import("@/render/Stage"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#0b0d12]" />,
});

export function App() {
  useShortcuts();
  useVoice();

  // Phones start with the preview; the chat opens from the top bar.
  useEffect(() => {
    if (window.innerWidth < 768) useLayout.getState().setChatOpen(false);
  }, []);

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

  const chatOpen = useLayout((s) => s.chatOpen);

  return (
    // Lovable-style editor: top bar, chat on the left, framed live preview on the right.
    <main className="bg-shell flex h-dvh w-full flex-col">
      <AppHeader />
      <div className="relative flex min-h-0 flex-1">
        <div
          className={`shrink-0 overflow-hidden transition-[width] duration-200 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 ${
            chatOpen ? "w-[340px] max-md:w-full xl:w-[400px]" : "w-0"
          }`}
        >
          <div className="h-full w-[340px] max-md:w-full xl:w-[400px]">
            <ChatPanel />
          </div>
        </div>
        <div className="min-w-0 flex-1 p-2 pt-0 pl-0 max-md:pl-2">
          <section
            aria-label="Preview"
            className="relative h-full overflow-hidden rounded-xl border border-white/10 bg-[#0b0d12]"
          >
            <StageFrame>
              <Stage />
            </StageFrame>
            {process.env.NODE_ENV === "development" && (
              <>
                <DevPanel />
                <DevOverlay />
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
