"use client";

import { useEffect, useState } from "react";
import { useDirector } from "@/render/camera/director";
import { recordAndDownload, stopRecording, type Quality } from "@/render/camera/recording";
import { withCut, type ShotKind } from "@/render/camera/shots";
import { useInteraction } from "@/scene/interaction";
import { useScene } from "@/scene/store";
import { DIRECTOR_SHOTS, directorShot } from "./director-shot";

/**
 * Director mode: frame the view as a 9:16 reel, preview cinematic shots of
 * the selection (or the whole scene) and record them as vertical video.
 */
export function DirectorPanel({ onClose }: { onClose: () => void }) {
  const [shot, setShot] = useState<ShotKind>("flyover");
  const [slow, setSlow] = useState(false);
  const [quality, setQuality] = useState<Quality>("1080p");
  const [error, setError] = useState<string | null>(null);
  const recording = useDirector((s) => s.recording);
  const selectedId = useInteraction((s) => s.selectedId);
  const selectedName = useScene((s) =>
    selectedId ? (s.world.nodes[selectedId]?.name ?? null) : null,
  );

  // Director mode frames the view as a reel while the panel is open.
  useEffect(() => {
    useDirector.getState().setFrame("vertical");
    return () => useDirector.getState().setFrame("full");
  }, []);

  const preview = () => {
    const move = directorShot(shot, slow);
    if (move) useDirector.getState().play(withCut(move));
  };
  const record = async () => {
    const move = directorShot(shot, slow);
    if (!move) return;
    setError(null);
    try {
      await recordAndDownload(move, quality);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // The top bar shows the REC badge while recording.
  if (recording) return null;

  return (
    <div className="popover w-64 space-y-3 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium text-white/90">Director</span>
        <button type="button" onClick={onClose} className="text-white/50 hover:text-white">
          Close
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {DIRECTOR_SHOTS.map((s) => (
          <Chip key={s.kind} active={shot === s.kind} onClick={() => setShot(s.kind)}>
            {s.label}
          </Chip>
        ))}
      </div>
      <div className="text-white/50">
        Subject: <span className="text-white/80">{selectedName ?? "whole scene"}</span>
        {!selectedName && <span> (click an object to focus on it)</span>}
      </div>
      <div className="flex gap-1">
        <Chip active={!slow} onClick={() => setSlow(false)}>
          Normal
        </Chip>
        <Chip active={slow} onClick={() => setSlow(true)}>
          Slow
        </Chip>
        <span className="flex-1" />
        <Chip active={quality === "1080p"} onClick={() => setQuality("1080p")}>
          1080p
        </Chip>
        <Chip active={quality === "720p"} onClick={() => setQuality("720p")}>
          720p
        </Chip>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={preview}
          className="flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-white/85 hover:bg-white/15"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={() => void record()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-500/80 px-2 py-1.5 font-medium text-white hover:bg-red-500"
        >
          <span className="size-2 rounded-full bg-white" />
          Record
        </button>
      </div>
      <div className="text-white/40">Saves a 9:16 video ({quality}) when the shot ends.</div>
      {error && <div className="text-red-300">{error}</div>}
    </div>
  );
}

/** REC timer and Stop, shown whenever a recording runs (also when started by voice). */
export function RecordingBadge({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <div className="glass flex items-center gap-3 px-3 py-2 text-xs">
      <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
      <span className="font-medium text-white/90 tabular-nums">
        REC {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </span>
      <button
        type="button"
        onClick={stopRecording}
        className="rounded-md bg-white/10 px-2 py-1 text-white/85 hover:bg-white/15"
      >
        Stop
      </button>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-2 py-1 transition ${active ? "bg-sky-400/25 text-sky-100" : "text-white/60 hover:bg-white/10"}`}
    >
      {children}
    </button>
  );
}
