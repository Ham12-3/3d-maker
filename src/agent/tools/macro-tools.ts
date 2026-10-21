import { z } from "zod";
import { MacroSchema, RelationSchema } from "@/scene/schema";
import { findMacro, generaliseSteps, instantiateMacro, listMacros, macroId } from "../macros";
import { executeToolCall } from "./index";
import { defineTool, fail } from "./types";

const saveInput = z.object({
  name: z.string().min(2).max(40).describe("What to call it, e.g. 'cosy village'"),
  description: z.string().max(120).optional(),
});

export const saveMacroTool = defineTool({
  name: "save_macro",
  pending: "Saving the recipe",
  description:
    "Save what was just built as a reusable recipe, when the user says e.g. 'save this as cosy village'. " +
    "It saves the previous command's building steps (or this command's, if you built something earlier in this turn), with relations instead of coordinates.",
  input: saveInput,
  execute({ name, description }, ctx) {
    const steps = ctx.recorder?.length ? ctx.recorder : (ctx.previousTurn?.steps ?? []);
    if (steps.length === 0)
      return fail("There's nothing to save yet: build something first, then save it.");
    const id = macroId(name);
    const macro = MacroSchema.parse({
      id,
      name,
      description: description ?? `Saved from "${ctx.previousTurn?.command ?? name}"`,
      steps: generaliseSteps(steps, ctx.getWorld()),
      builtIn: false,
    });
    ctx.edit(`Save macro ${id}`, (draft) => {
      draft.macros[id] = macro;
    });
    return {
      ok: true,
      activity: `Saved "${name}"`,
      result: `Saved macro ${id} with ${macro.steps.length} steps (${macro.steps.map((s) => s.tool).join(", ")}).`,
    };
  },
});

const applyInput = z.object({
  name: z.string().min(2).max(40).describe("Macro id or name, e.g. 'cosy_village', 'spooky'"),
  anchor: z
    .object({
      target: z.string().describe("Where to build it: node id, region id or 'pointer'"),
      predicate: RelationSchema.shape.predicate
        .optional()
        .describe("Default: the recipe's own relation, else near"),
      distance: z.number().positive().optional(),
    })
    .optional()
    .describe("Default: the pointer, or the centre of the view"),
  include_environment: z
    .boolean()
    .optional()
    .describe(
      "Also apply the recipe's sky/time/fog (default true; false for 'another X' in an existing scene)",
    ),
});

export const applyMacroTool = defineTool({
  name: "apply_macro",
  pending: "Building from a recipe",
  description:
    "Build a saved or built-in recipe in one go (fast, no guessing). Built-ins: spooky, cosy_village, tropical_island, winter_wonderland, alien_planet. " +
    "Use it for 'make another cosy village by the river' (anchor near river_1, include_environment false) or 'make it a winter wonderland'. " +
    "Saved recipes are listed under MACROS in the scene summary.",
  input: applyInput,
  async execute({ name, anchor, include_environment }, ctx) {
    const world = ctx.getWorld();
    const macro = findMacro(world, name);
    if (!macro) {
      return fail(
        `No macro "${name}". Available: ${listMacros(world)
          .map((m) => m.id)
          .join(", ")}`,
      );
    }
    const calls = instantiateMacro(macro, world, anchor ?? { target: "pointer" });
    const lines: string[] = [];
    let failed = 0;
    for (const call of calls) {
      if (include_environment === false && call.tool === "set_environment") continue;
      const r = await executeToolCall(call.tool, call.input, ctx);
      if (r.isError) failed++;
      lines.push(
        `${r.isError ? "ERROR " : ""}${call.tool}: ${r.content.split("\n").slice(0, 3).join(" / ")}`,
      );
    }
    return {
      ok: true,
      activity: `Built ${macro.name}`,
      result: `Applied ${macro.id} (${calls.length - failed}/${calls.length} steps ok):\n${lines.join("\n")}`,
    };
  },
});
