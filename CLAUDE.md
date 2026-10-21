# Speakworld

Voice-driven 3D world builder. You talk, Claude edits a JSON scene graph through typed tools, and React Three Fiber renders it. The full product brief lives in the original build prompt; this file holds what a new session needs to work in the repo.

## Commands

```bash
pnpm dev          # Next.js dev server on http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint (flat config)
pnpm test         # vitest run (unit tests + evals later)
pnpm format       # prettier --write
pnpm build        # production build
```

Before calling a phase done: `pnpm typecheck && pnpm lint && pnpm test` must all pass.

`.env.local` needs `ANTHROPIC_API_KEY` for the agent; without it `/api/agent` returns a clear 500 and the command bar shows it.

## Layout

```
src/
  app/            Next.js App Router; api/agent/route.ts is the Claude proxy
  agent/          Agent: config, system prompt, scene summary, client loop, status, tools/
    tools/        One file per tool: zod schema + description + executor; index.ts = registry
  layout/         Layout solver (relations -> coordinates), predicates, regions, spatial hash
  scene/          World data: zod schema, default world, store, ops, terrain height field
    worlds/default.json   the starting world (edit + reload to change it)
  render/         R3F components (Stage, World, Terrain, SkySystem, PointerMarker, nodes/)
    camera/       shots.ts (pure shot maths), director.ts (store), CameraRig.tsx (player)
  ui/             DOM overlays (CommandBar, Toolbar, DevPanel, shortcuts)
  lib/            Generic helpers: seeded RNG, simplex noise, rate limiter
```

Planned (not built yet): `agent/judge.ts`, `assets/`, `voice/`, `evals/`.

## Architecture rules

- **The scene graph is the source of truth.** `World` (in `scene/schema.ts`) is plain JSON. Rendering is a pure function of it. The LLM only edits it through typed tools.
- **One schema source.** Zod schemas in `scene/schema.ts`; TS types are `z.infer`'d from them. Claude tool JSON Schemas are generated from each tool's zod input with `z.toJSONSchema` (`agent/tools/index.ts#toolDefinitions`).
- **All world changes go through `store.edit(label, recipe)`** (`scene/store.ts`). Recipes are Immer producers; reusable ones live in `scene/ops.ts`. Never `setState({ world })` directly except `replaceWorld` (load).
- **Undo/redo = Immer patches.** Each `edit` outside a transaction is one undo step. `beginTransaction` / `commitTransaction` merge every edit in between into one step while still applying them live. `rollbackTransaction` reverts an open transaction. Undo/redo are ignored while a transaction is open; nesting throws.
- **Transient UI state** (selection, pointer hit) lives in `scene/interaction.ts`, outside the world and outside undo. The pointer is cleared after each successful command (a ground click is a one-shot "there").
- **Per-node subscriptions.** `World.tsx` subscribes to node ids; each `NodeView` subscribes to its own node, so Immer structural sharing keeps re-renders local.
- **Animation runs in useFrame, not React state.** `SkySystem` eases every environment value (~1.5 s) and `useAnimatedTransform` pops nodes in and eases moves. Props on those objects are starting values only.

## Agent

- **Loop runs in the browser** (`agent/loop.ts#runAgentTurn`); the server route is a thin proxy that holds the key, adds the cached system prompt + tools, rate-limits (30/min per IP, in memory) and streams the SDK events back as NDJSON (`stream.toReadableStream()`).
- The client reads the stream with `BetaMessageStream.fromReadableStream()` and **runs each tool as soon as its `tool_use` block completes**, so the sky changes while Claude is still writing later calls. All tool results go back in one user message.
- **One command = one transaction = one undo step.** Refusal, `max_tokens` with tool use, a failed request or cancel (Escape) rolls the whole turn back.
- Caps: 12 tool calls, 3 model round trips per command (`agent/config.ts`).
- **`say` ends the turn** when every tool in that response succeeded: the loop skips the round trip that would only return `end_turn` (saves ~2.3 s per command). Failures still go back to Claude.
- Live baseline (Phase 1, Sonnet 5.5 at low effort): ~2.1 s to the first visible change, ~3.4 s per simple command, ~5.7k cached prompt tokens read on every request.
- Each command is a fresh conversation: user message = scene summary (`agent/summary.ts`) + `COMMAND: ...`. History is append-only within a turn, so preserved-thinking checks never trip.
- Tool executors are pure functions over a `ToolContext` (no React/globals) so tests and future evals run them headless. Inputs are always zod-validated; failures go back to Claude as `is_error` tool results.
- `add_objects` lets Claude name ids (`blue_sphere_1`) so later objects in the same call can reference them; taken ids are renamed and relations remapped. Items are solved in dependency order.

## Layout solver

- `layout/solver.ts#solvePlacements` is pure and seeded. For each item it gathers candidates from its positional relations, scores them against all relations, penalises overlaps (spatial hash, XZ footprints) and out-of-bounds, adds a small bonus for being in view, then snaps y to terrain (or the target's top for `on_top_of`). `facing` sets yaw so local +Z faces the target.
- left/right/in front/behind are relative to the camera's view direction.
- `followMovedAnchors` carries dependants along when an anchor moves or resizes (move the table, the cup follows) and re-aims `facing`.
- Region `size`: circle = [diameter, _, _], rect = [width, _, depth], ring = [outer diameter, _, inner diameter].

## Coordinate conventions

- Metres, Y up. Terrain is `TERRAIN_SIZE` (240 m) square, centred on the origin.
- `transform.position` is **absolute world space** at the node's **bottom-centre**. A node standing on the ground has `y = heightAt(x, z)`.
- Primitives are unit-sized with a bottom-centre pivot, so `scale` is the size in metres.
- `scene/terrain.ts#getHeightField(params)` is the single `heightAt(x, z)` used by the terrain mesh and the solver. Every terrain type is flat at y = 0 within `FLAT_RADIUS` (16 m) of the origin.
- Sun: `render/sun.ts`. Rises east (+x) at 5:30, overhead at 12:00, sets west (-x) at 18:30, tilted towards +z (the default camera side). A dim blue moon light fades in at night.

## Decisions log

- **TypeScript 6.0.3, not 7.** TS 7 (Go port) has no JS compiler API yet; typescript-eslint 8.x needs it (peer `<6.1.0`). Revisit when typescript-eslint supports 7.
- **ESLint 9.39, not 10.** `eslint-plugin-react` (via eslint-config-next 16.4) only supports ESLint up to 9.7+.
- **React pinned to 19.3.x.** R3F 9.8 peer range is `>=19 <19.4`.
- **Immer used directly, not zustand's immer middleware**, because the middleware doesn't expose patches.
- **No partial-JSON dependency.** The SDK's own stream reader parses partial tool input (`inputJson` snapshot); Phase 4 ghosts will use that.
- **Model:** Sonnet 5.5 (`claude-sonnet-5-5`) at effort `low` with adaptive thinking (Sonnet 5.5 rejects `thinking: disabled` and forced `tool_choice`). Server-side refusal fallback on (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), so the beta Messages API and Beta types are used throughout. Haiku 5.5 routing arrives in Phase 4.
- **Prompt caching:** `cache_control` on the system block caches tools + system. Keep both byte-identical between requests (tool list built once, fixed order, no per-request text in the system prompt). The server logs `cache_read` per request.
- **`add_objects` uses `shape` + `size`** (metres) in Phase 1 instead of the brief's `asset_query`/`scale_hint`; Phase 2 adds asset queries.
- **Speech to text (Phase 3):** OpenAI `gpt-live-transcribe` over WebRTC with `keywords` hints; verify the ephemeral-token endpoint then.
- **Styling:** Tailwind v4 (`@import "tailwindcss"` in `globals.css`), with a `glass` utility for overlays.
- **Dev affordances:** in development, `window.__scene` exposes the store, a DevPanel (top right) makes manual edits, and each command logs `[agent] status tools iterations first-change total` to the console.

## Known issues

- pnpm reports "Ignored build scripts: unrs-resolver". It ships prebuilt binaries, so lint works without approving it.
- `next/font/google` fetches Inter at build time; offline builds fall back to system fonts.
- The rate limiter is per server instance (fine for dev; revisit for Vercel in Phase 7).
- Stars mount/unmount rather than fade.
