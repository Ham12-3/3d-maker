"use client";

import { downloadBlob, slugify } from "@/lib/download";
import { sceneStore } from "@/scene/store";
import { useDirector } from "./director";
import { withCut, type CameraMove } from "./shots";

/**
 * Records a camera move as a vertical (9:16) video for reels. The canvas is
 * framed 9:16 and rendered at the output height; each frame is copied into a
 * fixed-size 2D canvas (exactly 1080x1920) whose stream MediaRecorder encodes.
 * Recording is real time, so a slow GPU gives a choppier video, not a slower
 * one: 720p is the smoother option on integrated graphics.
 */

export const QUALITIES = {
  "1080p": { width: 1080, height: 1920 },
  "720p": { width: 720, height: 1280 },
} as const;
export type Quality = keyof typeof QUALITIES;

const FPS = 30;
const MAX_SECONDS = 60;
const SETTLE_MS = 350;
const TAIL_MS = 400;

type Sink = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
let sink: Sink | null = null;

/** The 2D canvas being recorded, while a recording runs (used by RecordFrames). */
export function recordingSink(): Sink | null {
  return sink;
}

/** Best container the browser can record: MP4 (H.264) for reels where supported, else WebM. */
export function pickMimeType(
  isSupported: (type: string) => boolean = (t) => MediaRecorder.isTypeSupported(t),
): string | null {
  const candidates = [
    "video/mp4;codecs=avc1.640028",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((t) => isSupported(t)) ?? null;
}

export function extensionFor(mimeType: string): "mp4" | "webm" {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

/** Plays `move` from its first frame and records it. Resolves with the video. */
export async function recordMove(move: CameraMove, quality: Quality = "1080p"): Promise<Blob> {
  const director = useDirector.getState();
  if (director.recording) throw new Error("Already recording");
  if (typeof MediaRecorder === "undefined") throw new Error("This browser can't record video");
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error("This browser can't record video");

  const previousFrame = director.frame;
  const { width, height } = QUALITIES[quality];
  director.setFrame("vertical");
  await sleep(SETTLE_MS);
  const frameEl = document.querySelector<HTMLElement>("[data-stage-frame]");
  const cssHeight = frameEl?.clientHeight || window.innerHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not create the recording canvas");
  sink = { canvas, ctx };
  director.setRecording({ width, height, dpr: height / cssHeight, startedAt: Date.now() });

  try {
    await sleep(SETTLE_MS); // let the canvas resize to the new pixel ratio
    const stream = canvas.captureStream(FPS);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: quality === "1080p" ? 12_000_000 : 6_000_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

    recorder.start(500);
    useDirector.getState().play(withCut(move));
    await moveEnded(MAX_SECONDS * 1000);
    await sleep(TAIL_MS);
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    return new Blob(chunks, { type: mimeType.split(";")[0] });
  } finally {
    sink = null;
    useDirector.getState().setRecording(null);
    useDirector.getState().setFrame(previousFrame);
  }
}

/** Records `move` and saves the video as speakworld-<title>.mp4 (or .webm). */
export async function recordAndDownload(move: CameraMove, quality: Quality = "1080p") {
  const video = await recordMove(move, quality);
  const title = slugify(sceneStore.getState().world.title);
  downloadBlob(video, `speakworld-${title}.${extensionFor(video.type)}`);
  return video;
}

/** Ends a recording early (the video keeps what was recorded so far). */
export function stopRecording(): void {
  if (useDirector.getState().recording) useDirector.getState().stop();
}

/** Resolves when the playing move finishes or is stopped (a drag, Stop, or the cap). */
function moveEnded(maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(() => {
      useDirector.getState().stop();
      done();
    }, maxMs);
    const unsubscribe = useDirector.subscribe((s) => {
      if (s.move === null) done();
    });
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
