import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoredWorld, WorldRepo } from "./repo";
import { WORLD_ID_PATTERN } from "./ids";

/** Development fallback: one JSON file per world plus a JPEG, under `dir`. */
export function fileRepo(dir: string): WorldRepo {
  const worlds = path.join(dir, "worlds");
  const thumbs = path.join(dir, "thumbnails");
  // Ids are validated before any path is built from them.
  const safe = (id: string) => {
    if (!WORLD_ID_PATTERN.test(id)) throw new Error(`Bad world id "${id}"`);
    return id;
  };
  const readOrNull = async (file: string) =>
    readFile(file).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });

  return {
    kind: "file",

    async get(id) {
      const buf = await readOrNull(path.join(worlds, `${safe(id)}.json`));
      return buf ? (JSON.parse(buf.toString("utf8")) as StoredWorld) : null;
    },

    async save(row) {
      await mkdir(worlds, { recursive: true });
      await writeFile(path.join(worlds, `${safe(row.id)}.json`), JSON.stringify(row));
    },

    async putThumbnail(id, jpeg) {
      await mkdir(thumbs, { recursive: true });
      await writeFile(path.join(thumbs, `${safe(id)}.jpg`), jpeg);
      return `/api/worlds/${id}/thumbnail?v=${Date.now()}`;
    },

    async readThumbnail(id) {
      return readOrNull(path.join(thumbs, `${safe(id)}.jpg`));
    },
  };
}
