"use client";

import { useRef, useState } from "react";
import { downloadBlob, slugify } from "@/lib/download";
import { exportGlb } from "@/render/exporter";
import { useInteraction } from "@/scene/interaction";
import { WorldSchema } from "@/scene/schema";
import { sceneStore } from "@/scene/store";
import { shareWorld, unlinkShare, useShare } from "@/share/client";

/** Share a read-only link, export GLB / JSON, or import a JSON world. */
export function ShareMenu({ onClose }: { onClose: () => void }) {
  const { url, kind, saving, error } = useShare();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const title = () => slugify(sceneStore.getState().world.title);

  const share = async () => {
    setCopied(false);
    try {
      const link = await shareWorld();
      await navigator.clipboard?.writeText(link).then(
        () => setCopied(true),
        () => {},
      );
    } catch {
      // useShare holds the error.
    }
  };

  const exportGlbFile = async () => {
    setBusy("glb");
    setMessage(null);
    // The selection tint would end up baked into the export.
    useInteraction.getState().select(null);
    try {
      downloadBlob(await exportGlb(), `speakworld-${title()}.glb`);
    } catch (err) {
      setMessage(`Export failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const exportJson = () => {
    const json = JSON.stringify(sceneStore.getState().world, null, 2);
    downloadBlob(new Blob([json], { type: "application/json" }), `speakworld-${title()}.json`);
  };

  const importJson = async (file: File) => {
    setMessage(null);
    try {
      const parsed = WorldSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error("not a Speakworld world file");
      sceneStore.getState().replaceWorld(parsed.data);
      unlinkShare();
      setMessage(`Opened "${parsed.data.title}"`);
    } catch (err) {
      setMessage(`Import failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="popover w-72 space-y-3 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium text-white/90">Share</span>
        <button type="button" onClick={onClose} className="text-white/50 hover:text-white">
          Close
        </button>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void share()}
        className="brand-gradient w-full rounded-lg px-2 py-1.5 font-semibold text-white hover:brightness-110 disabled:opacity-50"
      >
        {saving ? "Saving..." : url ? "Update link" : "Create share link"}
      </button>
      {url && (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md bg-black/30 px-2 py-1 text-white/80 outline-none"
            />
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-white/10 px-2 py-1 text-white/85 hover:bg-white/15"
            >
              Open
            </a>
          </div>
          <div className="text-white/45">
            {copied ? "Copied. " : ""}Anyone with the link can view (read-only).
            {kind === "link" && " The world is packed into the link itself."}
          </div>
        </div>
      )}
      {error && <div className="text-red-300">{error}</div>}

      <div className="grid grid-cols-3 gap-1 border-t border-white/10 pt-3">
        <MenuButton onClick={() => void exportGlbFile()} disabled={busy === "glb"}>
          {busy === "glb" ? "Exporting" : "Export GLB"}
        </MenuButton>
        <MenuButton onClick={exportJson}>Export JSON</MenuButton>
        <MenuButton onClick={() => fileRef.current?.click()}>Open JSON</MenuButton>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importJson(file);
          e.target.value = "";
        }}
      />
      {message && <div className="text-white/60">{message}</div>}
    </div>
  );
}

function MenuButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md bg-white/5 px-1.5 py-1.5 text-white/75 hover:bg-white/10 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
