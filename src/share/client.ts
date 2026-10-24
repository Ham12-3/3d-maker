"use client";

import { create } from "zustand";
import { captureView } from "@/render/capture";
import { useDirector } from "@/render/camera/director";
import { WorldSchema, type World } from "@/scene/schema";
import { sceneStore } from "@/scene/store";
import { encodeWorld, HASH_KEY, MAX_LINK_CHARS } from "./link";

/**
 * Browser side of sharing. The first share creates a link and keeps its edit
 * token in localStorage; sharing again updates the same link. Opening someone
 * else's world and sharing it creates a new link (a remix).
 * When the server has no storage (a deployment without a database), the
 * world is packed into the link itself instead (`share/link.ts`).
 */

const TOKENS_KEY = "speakworld:edit-tokens";
/** Link preview size (Open Graph). */
const THUMB = { maxWidth: 1200, aspect: 1200 / 630 };

type ShareState = {
  /** The share id the current world is linked to, if any. */
  id: string | null;
  url: string | null;
  /** "stored": saved on the server; "link": the world travels in the URL. */
  kind: "stored" | "link" | null;
  saving: boolean;
  error: string | null;
};

export const useShare = create<ShareState>()(() => ({
  id: null,
  url: null,
  kind: null,
  saving: false,
  error: null,
}));

export type LoadedWorld = { id: string; title: string; world: World; thumbnailUrl: string | null };

/** Save (or update) the current world and return its absolute share URL. */
export async function shareWorld(): Promise<string> {
  useShare.setState({ saving: true, error: null });
  try {
    // Open the link from the view the user is looking at now.
    const world: World = { ...sceneStore.getState().world, camera: useDirector.getState().live };
    if (!(await serverStorage())) {
      const url = await linkFor(world);
      useShare.setState({ id: null, url, kind: "link", saving: false });
      return url;
    }
    const thumbnail = (await captureView(THUMB))?.data;
    const body = JSON.stringify({ world, thumbnail });
    const { id } = useShare.getState();
    const token = id ? readTokens()[id] : undefined;

    let res =
      id && token
        ? await fetch(`/api/worlds/${id}`, {
            method: "PUT",
            headers: { "content-type": "application/json", "x-edit-token": token },
            body,
          })
        : null;
    // No token, or the link is gone or not ours: make a new one.
    if (!res || res.status === 403 || res.status === 404) {
      res = await fetch("/api/worlds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    }
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      editToken?: string;
      error?: string;
    };
    if (!res.ok || !json.id) throw new Error(json.error ?? `Save failed (${res.status})`);
    if (json.editToken) writeToken(json.id, json.editToken);
    const url = `${location.origin}/w/${json.id}`;
    useShare.setState({ id: json.id, url, kind: "stored", saving: false });
    return url;
  } catch (err) {
    useShare.setState({ saving: false, error: (err as Error).message });
    throw err;
  }
}

export async function fetchSharedWorld(id: string): Promise<LoadedWorld> {
  const res = await fetch(`/api/worlds/${encodeURIComponent(id)}`);
  const json = (await res.json().catch(() => ({}))) as Partial<LoadedWorld> & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Could not load world (${res.status})`);
  return { ...(json as LoadedWorld), world: WorldSchema.parse(json.world) };
}

/** Put a loaded world in the editor and fly the camera to its saved view. */
export function openInEditor(loaded: Pick<LoadedWorld, "world"> & { id?: string }): void {
  sceneStore.getState().replaceWorld(loaded.world);
  const owned = Boolean(loaded.id && readTokens()[loaded.id]);
  useShare.setState({
    id: owned ? loaded.id! : null,
    url: owned ? `${location.origin}/w/${loaded.id}` : null,
    kind: owned ? "stored" : null,
    error: null,
  });
  const { position, target } = loaded.world.camera;
  useDirector.getState().play({ kind: "tween", position, target, duration: 1.2 });
}

/** Called after replacing the world from elsewhere (import, new): forget the link. */
export function unlinkShare(): void {
  useShare.setState({ id: null, url: null, kind: null, error: null });
}

/** A link with the world packed into its #fragment. */
export async function linkFor(world: World, path = "/v"): Promise<string> {
  const encoded = await encodeWorld(world);
  if (encoded.length > MAX_LINK_CHARS) {
    throw new Error("This world is too big for a link. Use Export JSON to share it.");
  }
  return `${location.origin}${path}#${HASH_KEY}${encoded}`;
}

let storage: Promise<boolean> | null = null;

/** Whether the server can store shared worlds (asked once per page load). */
function serverStorage(): Promise<boolean> {
  storage ??= fetch("/api/worlds")
    .then((r) => (r.ok ? (r.json() as Promise<{ available?: boolean }>) : null))
    .then((j) => j?.available === true)
    .catch(() => false);
  return storage;
}

function readTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeToken(id: string, token: string): void {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify({ ...readTokens(), [id]: token }));
  } catch {
    // Private mode: the link still works, it just can't be updated later.
  }
}
