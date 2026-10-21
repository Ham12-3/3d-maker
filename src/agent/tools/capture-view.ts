import { z } from "zod";
import { defineTool, fail } from "./types";

const input = z.object({
  reason: z
    .string()
    .max(80)
    .optional()
    .describe("What you want to check, e.g. 'is the cabin facing the lake'"),
});

export const captureViewTool = defineTool({
  name: "capture_view",
  pending: "Looking at the scene",
  description:
    "See the current view as an image. Use it when asked to polish, review or fix how the scene looks, or to check a big build. " +
    "At most once per command; it costs time.",
  input,
  async execute(_input, ctx) {
    const image = await ctx.captureView?.();
    if (!image) return fail("No rendered view is available here; rely on the scene summary.");
    return {
      ok: true,
      activity: "Looked at the scene",
      result: `Current view (${image.width}x${image.height}), camera looking at the CAMERA target in the summary.`,
      images: [image],
    };
  },
});
