import { z } from "zod";
import { computeShot, fogVisibility, SHOT_KINDS } from "@/render/camera/shots";
import { focusFor } from "./common";
import { defineTool, fail } from "./types";

const input = z.object({
  shot: z
    .enum(SHOT_KINDS)
    .describe(
      "establishing = wide view; close_up; orbit = circle the target; flyover = cinematic sweeping pass; " +
        "first_person = eye level; reveal = crane up from low and close to wide; push_in = slow dolly towards the target",
    ),
  target: z
    .string()
    .optional()
    .describe(
      "Node id, region id, 'pointer', 'origin' or 'scene'. Defaults to the selection, else the whole scene.",
    ),
  duration_seconds: z
    .number()
    .min(0.5)
    .max(30)
    .optional()
    .describe("'slow' ~ 1.5x the default; defaults suit each shot"),
  record: z
    .boolean()
    .optional()
    .describe(
      "Also record the move as a vertical 1080x1920 video (downloads when done). Only when the user asks to record, film or make a video/reel.",
    ),
});

export const setCameraTool = defineTool({
  name: "set_camera",
  pending: "Moving the camera",
  description:
    "Move the camera to a shot. Use when the user asks to look at, show, frame, orbit or fly over something, " +
    "or after a big build so the result is in view. Does not change the world.",
  input,
  execute({ shot, target, duration_seconds, record }, ctx) {
    const focus = focusFor(target, ctx);
    if (typeof focus === "string") return fail(focus);
    const move = computeShot(
      shot,
      focus,
      ctx.camera,
      duration_seconds,
      fogVisibility(ctx.getWorld().environment.fog),
      // Recordings are framed 9:16.
      record ? 9 / 16 : ctx.viewAspect,
    );
    ctx.moveCamera(move, record ? { record: true } : undefined);
    const name = shot.replace("_", " ");
    const subject = target ?? ctx.selection ?? "the scene";
    return {
      ok: true,
      activity: record ? `Recording a ${name}` : `Camera: ${name}`,
      result: record
        ? `Recording a ${name} of ${subject} as a vertical video (${move.duration.toFixed(0)} s); it downloads when done.`
        : `Camera moving to a ${name} shot of ${subject}.`,
    };
  },
});
