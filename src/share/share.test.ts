import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDefaultWorld } from "@/scene/defaults";
import { fileRepo } from "./file-repo";
import { hashToken, newWorldId, tokenMatches, WORLD_ID_PATTERN } from "./ids";
import type { WorldRepo } from "./repo";
import { createWorld, SaveBodySchema, updateWorld } from "./save";

// Smallest valid JPEG header bytes are enough for the magic-number check.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]).toString("base64");

describe("share ids", () => {
  it("makes valid, distinct ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newWorldId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(WORLD_ID_PATTERN);
  });

  it("checks edit tokens against their hash", () => {
    const hash = hashToken("secret-token");
    expect(tokenMatches("secret-token", hash)).toBe(true);
    expect(tokenMatches("other", hash)).toBe(false);
  });
});

describe("saving shared worlds", () => {
  let dir: string;
  let repo: WorldRepo;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "speakworld-"));
    repo = fileRepo(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("creates a world with a thumbnail and loads it back", async () => {
    const world = { ...loadDefaultWorld(), title: "Cosy village" };
    const created = await createWorld(repo, { world, thumbnail: JPEG });
    if (!created.ok) throw new Error(created.error);
    expect(created.editToken).toBeTruthy();
    expect(created.thumbnailUrl).toContain(`/api/worlds/${created.id}/thumbnail`);

    const row = await repo.get(created.id);
    expect(row?.title).toBe("Cosy village");
    expect(row?.world).toEqual(world);
    expect(row?.editTokenHash).not.toBe(created.editToken);
    expect(await repo.readThumbnail?.(created.id)).toBeTruthy();
  });

  it("updates only with the right edit token", async () => {
    const world = loadDefaultWorld();
    const created = await createWorld(repo, { world });
    if (!created.ok) throw new Error(created.error);

    const renamed = { ...world, title: "Renamed" };
    const denied = await updateWorld(repo, created.id, "wrong-token", { world: renamed });
    expect(denied).toMatchObject({ ok: false, status: 403 });

    const updated = await updateWorld(repo, created.id, created.editToken!, { world: renamed });
    expect(updated.ok).toBe(true);
    expect((await repo.get(created.id))?.title).toBe("Renamed");

    expect(await updateWorld(repo, "missing123", "x", { world })).toMatchObject({ status: 404 });
  });

  it("refuses thumbnails that aren't JPEGs and invalid worlds", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const result = await createWorld(repo, { world: loadDefaultWorld(), thumbnail: png });
    expect(result).toMatchObject({ ok: false, status: 400 });

    const broken = { ...loadDefaultWorld(), version: 2 };
    expect(SaveBodySchema.safeParse({ world: broken }).success).toBe(false);
  });

  it("never builds a file path from a bad id", async () => {
    await expect(repo.get("../../etc/passwd")).rejects.toThrow(/Bad world id/);
  });
});
