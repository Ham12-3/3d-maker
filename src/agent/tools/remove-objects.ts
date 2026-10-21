import { z } from "zod";
import { removeNodes } from "@/scene/ops";
import { SelectorFields, resolveSelector } from "./common";
import { defineTool, fail } from "./types";

const input = z.object(SelectorFields);

export const removeObjectsTool = defineTool({
  name: "remove_objects",
  pending: "Removing objects",
  description:
    "Remove objects by ids and/or tag. Children parented to them are removed too. " +
    'Examples: remove this => {"ids":["<SELECTION id>"]}; remove all the trees => {"tag":"tree"}.',
  input,
  execute(selector, ctx) {
    const world = ctx.getWorld();
    const sel = resolveSelector(world, selector);
    if (sel.ids.length === 0) {
      return fail(
        sel.unknown.length ? `Unknown ids: ${sel.unknown.join(", ")}` : "Nothing matched ids/tag.",
      );
    }
    const before = new Set(Object.keys(world.nodes));
    ctx.edit(`Remove ${sel.ids.join(", ")}`, (draft) => {
      removeNodes(sel.ids)(draft);
      // Forget relations that pointed at removed objects.
      for (const node of Object.values(draft.nodes)) {
        node.relations = node.relations.filter(
          (r) => r.target in draft.nodes || !before.has(r.target),
        );
      }
    });
    const removed = [...before].filter((id) => !(id in ctx.getWorld().nodes));
    return {
      ok: true,
      activity: `Removed ${removed.length} object(s)`,
      result:
        `Removed: ${removed.join(", ")}` +
        (sel.unknown.length ? `\nIgnored unknown ids: ${sel.unknown.join(", ")}` : ""),
    };
  },
});
