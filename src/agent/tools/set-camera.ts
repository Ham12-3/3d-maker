import { z } from "zod";
import { computeShot } from "@/render/camera/shots";
import { focusFor } from "./common";
import { defineTool, fail } from "./types";

const input = z.object({
  shot: z
    .enum(["establishing", "close_up", "orbit", "flyover", "first_person"])
    .describe(
      "establishing = wide view; close_up; orbit = circle the target; flyover = cinematic glide over; first_person = eye level",
    ),
  target: z
    .string()
    .optional()
    .describe(
      "Node id, region id, 'pointer' or 'origin'. Defaults to the selection, else the whole scene.",
    ),
  duration_seconds: z.number().min(0.5).max(30).optional(),
});

export const setCameraTool = defineTool({
  name: "set_camera",
  pending: "Moving the camera",
  description:
    "Move the camera to a shot. Use when the user asks to look at, show, frame, orbit or fly over something, " +
    "or after a big build so the result is in view. Does not change the world.",
  input,
  execute({ shot, target, duration_seconds }, ctx) {
    const focus = focusFor(target, ctx);
    if (typeof focus === "string") return fail(focus);
    ctx.moveCamera(computeShot(shot, focus, ctx.camera, duration_seconds));
    return {
      ok: true,
      activity: `Camera: ${shot.replace("_", " ")}`,
      result: `Camera moving to a ${shot} shot of ${target ?? ctx.selection ?? "the scene"}.`,
    };
  },
});
