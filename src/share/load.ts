import { cache } from "react";
import { WorldSchema } from "@/scene/schema";
import { WORLD_ID_PATTERN } from "./ids";
import { getRepo } from "./repo";

/**
 * A shared world for server rendering, validated (the stored JSON is not
 * trusted). Cached per request so metadata and the page share one read.
 */
export const loadSharedWorld = cache(async (id: string) => {
  if (!WORLD_ID_PATTERN.test(id)) return null;
  const repo = getRepo();
  if (!repo) return null;
  try {
    const row = await repo.get(id);
    if (!row) return null;
    const world = WorldSchema.safeParse(row.world);
    if (!world.success) {
      console.error(`[worlds] stored world ${id} is invalid`);
      return null;
    }
    return { id, title: row.title, world: world.data, thumbnailUrl: row.thumbnailUrl };
  } catch (err) {
    console.error(`[worlds] load ${id} failed:`, (err as Error).message);
    return null;
  }
});
