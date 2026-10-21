"use client";

import { runPolish } from "@/agent/run-command";
import { useAgentStatus } from "@/agent/status";
import { Credits } from "./Credits";

/** Top right: Polish (visual critique), its auto toggle, and Credits. */
export function TopBar() {
  const running = useAgentStatus((s) => s.running);
  const autoPolish = useAgentStatus((s) => s.autoPolish);

  return (
    <div className="absolute top-4 right-4 flex items-start gap-2">
      <div className="glass flex items-center gap-1 p-1">
        <button
          type="button"
          disabled={running}
          onClick={() => void runPolish()}
          title="Look at the scene and fix what doesn't match the request"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-white/85 transition hover:bg-white/10 disabled:opacity-30"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
          </svg>
          Polish
        </button>
        <label
          className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/60 hover:bg-white/10"
          title="Polish automatically after bigger builds"
        >
          <input
            type="checkbox"
            checked={autoPolish}
            onChange={(e) => useAgentStatus.setState({ autoPolish: e.target.checked })}
            className="accent-sky-400"
          />
          Auto
        </label>
      </div>
      <Credits />
    </div>
  );
}
