import { z } from "zod";
import { defineTool } from "./types";

const input = z.object({
  reason: z
    .string()
    .min(3)
    .max(120)
    .describe("Why this needs the larger model, e.g. 'multi-building village'"),
});

/**
 * Only offered to the fast model. The loop handles it specially: it undoes
 * anything already done this turn and re-runs the command on the main model.
 */
export const escalateTool = defineTool({
  name: "escalate",
  pending: "Thinking harder",
  description: [
    "Hand this command to a larger model. Call it FIRST and ALONE, before any other tool, only when the command needs:",
    "a composition of many different objects that must relate to each other (a village, a campsite with several parts, a furnished room),",
    "restyling the whole scene (make everything spooky / winter / alien), or careful reasoning about many existing objects.",
    "Handle everything else yourself: environment and mood changes, adding a few things, a lake with a forest, moving, resizing, removing, camera moves.",
  ].join(" "),
  input,
  execute({ reason }) {
    return { ok: true, activity: "Thinking harder", result: `Escalated: ${reason}` };
  },
});
