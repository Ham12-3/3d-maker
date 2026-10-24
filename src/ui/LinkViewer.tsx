"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { World } from "@/scene/schema";
import { decodeWorld, HASH_KEY, worldFromHash } from "@/share/link";
import { Viewer } from "./Viewer";

/** Unpacks the world from the link's #fragment (browser only), then shows it. */
export function LinkViewer() {
  const [state, setState] = useState<{ world: World; packed: string } | { error: string } | null>(
    null,
  );

  useEffect(() => {
    const packed = worldFromHash(location.hash);
    (packed ? decodeWorld(packed) : Promise.reject(new Error("no world")))
      .then((world) => setState({ world, packed: packed! }))
      .catch(() =>
        setState({
          error: packed ? "This link is damaged or incomplete." : "This link has no world in it.",
        }),
      );
  }, []);

  if (state && "world" in state) {
    return <Viewer world={state.world} remixHref={`/#${HASH_KEY}${state.packed}`} />;
  }
  return (
    <main className="grid h-dvh w-full place-items-center bg-[#0b0d12] text-sm text-white/60">
      {state ? (
        <div className="space-y-2 text-center">
          <div>{state.error}</div>
          <Link href="/" className="text-sky-300 hover:underline">
            Open Speakworld
          </Link>
        </div>
      ) : (
        "Opening world..."
      )}
    </main>
  );
}
