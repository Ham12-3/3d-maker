import { focusFor } from "@/agent/tools/common";
import { useDirector } from "@/render/camera/director";
import { computeShot, fogVisibility, type CameraMove, type ShotKind } from "@/render/camera/shots";
import { useInteraction } from "@/scene/interaction";
import { sceneStore } from "@/scene/store";

/** The shots Director mode offers, in button order. */
export const DIRECTOR_SHOTS: { kind: ShotKind; label: string }[] = [
  { kind: "flyover", label: "Flyover" },
  { kind: "orbit", label: "Orbit" },
  { kind: "reveal", label: "Reveal" },
  { kind: "push_in", label: "Push in" },
  { kind: "establishing", label: "Wide" },
];

const SLOW = 1.6;
const DEFAULT_SECONDS: Partial<Record<ShotKind, number>> = {
  flyover: 10,
  orbit: 14,
  reveal: 8,
  push_in: 7,
  establishing: 4,
};

/** A shot of the selection (or the whole scene), framed for a 9:16 reel. */
export function directorShot(kind: ShotKind, slow: boolean): CameraMove | null {
  const world = sceneStore.getState().world;
  const camera = useDirector.getState().live;
  const focus = focusFor(undefined, {
    getWorld: () => world,
    selection: useInteraction.getState().selectedId,
    pointer: null,
    camera,
  });
  if (typeof focus === "string") return null;
  const seconds = (DEFAULT_SECONDS[kind] ?? 6) * (slow ? SLOW : 1);
  return computeShot(kind, focus, camera, seconds, fogVisibility(world.environment.fog), 9 / 16);
}
