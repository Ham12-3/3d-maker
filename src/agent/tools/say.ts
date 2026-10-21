import { z } from "zod";
import { defineTool } from "./types";

const input = z.object({
  text: z.string().min(1).max(120).describe("One short sentence, under 15 words"),
});

export const sayTool = defineTool({
  name: "say",
  pending: "Replying",
  description:
    "Show the user a short reply (one sentence, under 15 words), e.g. what you assumed or a quick suggestion. " +
    "At most once per turn, usually last. Example: 'Done. Want fireflies too?'",
  input,
  execute({ text }, ctx) {
    ctx.say(text);
    return { ok: true, activity: text, result: "Shown to the user." };
  },
});
