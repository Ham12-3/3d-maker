import { z } from "zod";
import { defineTool } from "./types";

const input = z.object({
  query: z.string().min(2).max(60).describe("1-3 words, e.g. 'log cabin'"),
  limit: z.number().int().min(1).max(8).optional(),
});

export const searchAssetsTool = defineTool({
  name: "search_assets",
  pending: "Searching models",
  description:
    "Search the 3D model library (bundled CC0 kit, then an online low-poly library). Only needed to choose between " +
    "options; add_objects with asset_query already picks the best match. Returns asset ids for add_objects.asset_id.",
  input,
  async execute({ query, limit }, ctx) {
    const found = await ctx.searchAllAssets(query, limit ?? 5);
    for (const c of found) ctx.candidates.set(`${c.source}:${c.id}`, c);
    if (found.length === 0)
      return { ok: true, activity: "No models found", result: `No models found for "${query}".` };
    const lines = found.map((c) => {
      const size = c.size ? `, ${c.size.map((v) => +v.toFixed(1)).join("x")}m` : "";
      const tris = c.triCount ? `, ${c.triCount} tris` : "";
      return `${c.source}:${c.id} "${c.name}" (${c.license}${size}${tris})`;
    });
    return { ok: true, activity: `Found ${found.length} models`, result: lines.join("\n") };
  },
});
