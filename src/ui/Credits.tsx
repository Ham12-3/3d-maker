"use client";

import { useMemo, useState } from "react";
import type { World } from "@/scene/schema";
import { useScene } from "@/scene/store";

type Credit = { key: string; text: string; license: string };

/** Top right: credits for every model in the world (CC-BY requires attribution). */
export function Credits() {
  const [open, setOpen] = useState(false);
  // Select a string, not fresh objects: a selector returning new objects on
  // every read makes the store subscription loop forever.
  const creditsKey = useScene((s) => JSON.stringify(collectCredits(s.world.nodes)));
  const credits = useMemo(() => JSON.parse(creditsKey) as Credit[], [creditsKey]);

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="glass px-3 py-1.5 text-xs text-white/80 transition hover:text-white"
        aria-expanded={open}
      >
        Credits{credits.length ? ` (${credits.length + 1})` : ""}
      </button>
      {open && (
        <div className="glass max-h-[60vh] w-80 space-y-3 overflow-y-auto p-4 text-xs leading-relaxed">
          <div>
            <div className="font-medium text-white/90">Kenney asset kits</div>
            <div className="text-white/60">
              Nature Kit, Holiday Kit and Survival Kit by Kenney (
              <Link href="https://kenney.nl">kenney.nl</Link>), CC0.
            </div>
          </div>
          {credits.length > 0 && (
            <div className="space-y-2">
              <div className="font-medium text-white/90">Models</div>
              {credits.map((c) => (
                <div key={c.key} className="text-white/60">
                  <Linkified text={c.text} /> <span className="text-white/40">({c.license})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function collectCredits(nodes: World["nodes"]): Credit[] {
  const seen = new Map<string, Credit>();
  for (const n of Object.values(nodes)) {
    const a = n.asset;
    if (!a || a.source === "kenney" || seen.has(a.url)) continue;
    seen.set(a.url, {
      key: a.url,
      text:
        a.attribution ?? `"${n.name}" from ${a.source === "polypizza" ? "Poly Pizza" : a.source}`,
      license: a.license,
    });
  }
  return [...seen.values()];
}

/** Attribution strings contain bare URLs; make them clickable. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s,]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <Link key={i} href={part.replace(/[.)]+$/, "")}>
            {part.replace(/^https?:\/\//, "").replace(/[.)]+$/, "")}
          </Link>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-sky-300 underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}
