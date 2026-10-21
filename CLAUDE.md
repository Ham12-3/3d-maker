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

## Layout

```
src/
  app/            Next.js App Router (page renders <App/>; API routes arrive in Phase 1)
  scene/          World data: zod schema, default world, store, ops, terrain height field
    worlds/default.json   the starting world (edit + reload to change it)
  render/         R3F components (Stage = Canvas, World, Terrain, SkySystem, nodes/)
  ui/             DOM overlays (Toolbar, DevPanel, shortcuts)
  lib/            Generic helpers: seeded RNG, simplex noise
```

Planned (not built yet): `agent/` (tools, loop, summary, judge), `layout/` (solver), `assets/`, `voice/`, `evals/`.

## Architecture rules

- **The scene graph is the source of truth.** `World` (in `scene/schema.ts`) is plain JSON. Rendering is a pure function of it. The LLM will only ever edit it through typed tools.
- **One schema source.** Zod schemas in `scene/schema.ts`; TS types are `z.infer`'d from them. Claude tool JSON Schemas will be generated with zod 4's built-in `z.toJSONSchema` (no converter dependency).
- **All world changes go through `store.edit(label, recipe)`** (`scene/store.ts`). Recipes are Immer producers; reusable ones live in `scene/ops.ts`. Never `setState({ world })` directly except `replaceWorld` (load).
- **Undo/redo = Immer patches.** Each `edit` outside a transaction is one undo step. `beginTransaction` / `commitTransaction` merge every edit in between into one step while still applying them live (an agent turn will be one transaction). `rollbackTransaction` reverts an open transaction. Undo/redo are ignored while a transaction is open; nesting throws.
- **Transient UI state** (selection, pointer hit) lives in `scene/interaction.ts`, outside the world and outside undo.
- **Per-node subscriptions.** `World.tsx` subscribes to node ids; each `NodeView` subscribes to its own node, so Immer structural sharing keeps re-renders local.

## Coordinate conventions

- Metres, Y up. Terrain is `TERRAIN_SIZE` (240 m) square, centred on the origin.
- `transform.position` is **absolute world space** at the node's **bottom-centre**. A node standing on the ground has `y = heightAt(x, z)`.
- Primitives are unit-sized with a bottom-centre pivot, so `scale` is the size in metres.
- `scene/terrain.ts#getHeightField(params)` is the single `heightAt(x, z)` used by the terrain mesh and (later) the solver. Every terrain type is flat at y = 0 within `FLAT_RADIUS` (16 m) of the origin, so the central build area is predictable.
- Sun: `render/sun.ts`. Rises east (+x) at 5:30, overhead at 12:00, sets west (-x) at 18:30, tilted towards +z (the default camera side).

## Decisions log

- **TypeScript 6.0.3, not 7.** TS 7 (Go port) has no JS compiler API yet; typescript-eslint 8.x needs it (peer `<6.1.0`). Revisit when typescript-eslint supports 7.
- **ESLint 9.39, not 10.** `eslint-plugin-react` (via eslint-config-next 16.4) only supports ESLint up to 9.7+.
- **React pinned to 19.3.x.** R3F 9.8 peer range is `>=19 <19.4`.
- **Immer used directly, not zustand's immer middleware**, because the middleware doesn't expose patches.
- **No partial-JSON dependency (planned for Phase 1).** `/api/agent` will return the SDK stream via `toReadableStream()`, and the client will read it with `MessageStream.fromReadableStream()`, whose `inputJson` event provides a parsed partial snapshot. Every tool input is still zod-validated before execution.
- **Models:** Sonnet 5.5 (`claude-sonnet-5-5`) only until Phase 4 adds Haiku 5.5 (`claude-haiku-5-5`) routing. Sonnet 5.5 rejects `thinking: {type: "disabled"}` and forced `tool_choice` (`any`/`tool`); use `between_tools` / `auto`.
- **Speech to text (Phase 3):** OpenAI `gpt-live-transcribe` over WebRTC with `keywords` hints; verify the ephemeral-token endpoint then.
- **Styling:** Tailwind v4 (`@import "tailwindcss"` in `globals.css`), with a `glass` utility for overlays.
- **Dev affordances:** in development, `window.__scene` exposes the store, and a DevPanel (bottom right) makes manual edits.

## Known issues

- pnpm reports "Ignored build scripts: unrs-resolver". It ships prebuilt binaries, so lint works without approving it.
- `next/font/google` fetches Inter at build time; offline builds fall back to system fonts.
