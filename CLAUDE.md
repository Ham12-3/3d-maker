# Speakworld

Voice-driven 3D world builder. You talk, Claude edits a JSON scene graph through typed tools, and React Three Fiber renders it. The full product brief lives in the original build prompt; this file holds what a new session needs to work in the repo.

## Commands

```bash
pnpm dev          # Next.js dev server on http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint (flat config)
pnpm test         # vitest run (unit tests; evals are skipped)
pnpm evals        # real Claude eval suite (~$0.09 a run), writes evals/results/<timestamp>.json
pnpm format       # prettier --write
pnpm build        # production build
node scripts/curate-kenney.mjs <dir>   # rebuild public/assets/kenney from extracted Kenney zips
```

Before calling a phase done: `pnpm typecheck && pnpm lint && pnpm test` must all pass.

`.env.local` needs `ANTHROPIC_API_KEY` for the agent (without it `/api/agent` returns a clear 500), `POLYPIZZA_API_KEY` for online models (without it objects fall back to primitives) and optionally `OPENAI_API_KEY` for the default speech engine (without it voice uses the browser's speech recognition).

## Layout

```
src/
  app/            Next.js App Router
    api/agent/            Claude proxy (streaming)
    api/assets/search/    Poly Pizza search proxy (cached a day)
    api/assets/file/[id]/ Poly Pizza GLB proxy (key stays on the server)
    api/stt/token/        OpenAI speech: GET availability, POST mints a 10-minute client secret
  agent/          config, system prompt, request builder, summary, client loop, judge, status, tools/
    tools/        One file per tool: zod schema + description + executor; index.ts = registry
  assets/         Kenney catalog + search, Poly Pizza client, GLB normalisation, load status
  layout/         Solver, predicates, regions, spatial hash, scatter (instanced nature), paths
  scene/          World schema, default world, store, ops, terrain (height field + lake carving)
  render/         R3F: Stage, World, Terrain, SkySystem, nodes/ (Primitive, AssetModel, Scatter, Lake, PathRibbon, Fireflies), camera/
  ui/             CommandBar, Toolbar, Credits, DevPanel, DevOverlay, shortcuts
  voice/          Transcriber interface, OpenAI (WebRTC) and Web Speech engines, push-to-talk controller, useVoice
  lib/            seeded RNG, simplex noise, rate limiter, TTL cache
evals/            cases/*.json, checks, base worlds, run.test.ts, results/
public/assets/kenney/   curated CC0 GLBs + manifest.json (sizes in metres)
scripts/          curate-kenney.mjs
```

Planned (not built yet): local Whisper engine (optional), visual critique, macros, persistence.

## Architecture rules

- **The scene graph is the source of truth.** `World` (in `scene/schema.ts`) is plain JSON. Rendering is a pure function of it. The LLM only edits it through typed tools.
- **One schema source.** Zod schemas in `scene/schema.ts`; TS types are `z.infer`'d from them. Claude tool JSON Schemas are generated from each tool's zod input with `z.toJSONSchema` (`agent/tools/index.ts#toolDefinitions`).
- **All world changes go through `store.edit(label, recipe)`** (`scene/store.ts`). Recipes are Immer producers; reusable ones live in `scene/ops.ts`. Never `setState({ world })` directly except `replaceWorld` (load).
- **Undo/redo = Immer patches.** Each `edit` outside a transaction is one undo step. `beginTransaction` / `commitTransaction` merge every edit in between into one step while still applying them live. `rollbackTransaction` reverts an open transaction. Undo/redo are ignored while a transaction is open; nesting throws.
- **Transient UI state** (selection, pointer hit) lives in `scene/interaction.ts`, outside the world and outside undo. The pointer is cleared after each successful command (a ground click is a one-shot "there").
- **Per-node subscriptions.** `World.tsx` subscribes to node ids; each `NodeView` subscribes to its own node, so Immer structural sharing keeps re-renders local.
- **Animation runs in useFrame, not React state.** `SkySystem` eases every environment value (~1.5 s), `useAnimatedTransform` pops nodes in and eases moves, `Scatter` grows instances in from the centre. Mutate per-frame things through refs (the React Compiler lint rules reject mutating hook-returned objects).
- **Derived, not stored:** forest/rock/grass instance positions, path polylines and lake-carved terrain are pure functions of the world (`layout/scatter.ts`, `layout/paths.ts`, `scene/terrain.ts#getWorldHeightField`). Renderer, solver, judge and tests all call the same functions.

## Agent

- **Loop runs in the browser** (`agent/loop.ts#runAgentTurn`); the server route is a thin proxy (key, cached system prompt + tools, rate limit 30/min per IP) that streams SDK events back as NDJSON. `agent/request.ts#agentRequest` builds the request for both the route and the evals.
- The client reads the stream with `BetaMessageStream.fromReadableStream()` and **runs each tool as soon as its `tool_use` block completes**, sequentially (tools are async: asset search). All tool results go back in one user message.
- **One command = one transaction = one undo step.** Refusal, `max_tokens` with tool use, a failed request or cancel (Escape) rolls the whole turn back.
- Caps: 12 tool calls, 3 model round trips per command (`agent/config.ts`).
- **`say` ends the turn** when every tool in that response succeeded (skips a round trip that would only return `end_turn`).
- **Judge** (`agent/judge.ts`) runs after the last tool on the nodes this turn touched (from the transaction's patches): floating, buried, in a lake, overlapping, out of bounds, node/instance budgets, broken model URLs. It fixes positions itself (same undo step) and sends what it can't fix back to Claude once as a `JUDGE:` message.
- **Auto-framing:** if a turn adds a lake or forest and Claude didn't call `set_camera`, the client plays an establishing shot of the whole scene, never further back than the fog lets you see (`fogVisibility`).
- Each command is a fresh conversation: user message = scene summary + `COMMAND: ...`. History is append-only within a turn.
- Tool executors are pure functions over a `ToolContext` (no React/globals; asset search injected), so tests and evals run them headless. Inputs are always zod-validated; failures go back as `is_error` tool results.
- Tools: `set_environment`, `add_procedural` (forest, rocks, grass, flowers, lake, path, fireflies), `add_objects` (`asset_query` / `asset_id` / `shape`), `update_objects`, `remove_objects`, `create_region`, `search_assets`, `set_camera`, `say`.

## Assets

- **Tiers:** bundled Kenney kit first (`assets/catalog.ts#searchKit`, instant, offline, CC0), then Poly Pizza via `/api/assets/search`. A kit model must match the query's head noun ("wooden cabin" never resolves to a fence). No match falls back to a primitive and the tool result says so.
- **Poly Pizza API v1.1:** `https://api.poly.pizza/v1.1/search/{kw}?Limit&License=1` (1 = CC0, 0 = CC-BY), header `x-auth-token`. The token is also required for files on `static.poly.pizza`, so GLBs are served by `/api/assets/file/[id]`, which only ever fetches `https://static.poly.pizza/*.glb`. Animated and >60k-tri models are filtered out. CC-BY attribution is stored on the node and listed in Credits.
- **Size semantics:** an asset node's `transform.scale` is its size box in metres (same as primitives). `AssetModel` normalises the GLB to bottom-centre and scales it uniformly to fit the box. Kit models keep their manifest proportions scaled to the requested height; online models fit the requested box.
- Instanced nature uses kit models: one `InstancedMesh` per (variant, mesh part). Forest species: pine, mixed, deciduous, autumn, palm, dead, snowy.

## Voice

- **One interface** (`voice/transcriber.ts`): `start`, `stop` (resolves after `onFinal`), `onPartial`, `onFinal`, `onError`, optional `level`, `dispose`.
- **Engine choice** (`voice/useVoice.ts`): OpenAI when `GET /api/stt/token` says the server has a key, else the browser's SpeechRecognition, else typing only. If OpenAI fails to connect, it falls back to browser speech.
- **OpenAI engine** (`voice/openai.ts`): `gpt-live-transcribe` over WebRTC. The server mints an ephemeral secret (`POST /v1/realtime/client_secrets`, session `type: "transcription"`, `turn_detection: null`, keyword hints from the scene); the browser POSTs its SDP offer to `/v1/realtime/calls`. The connection opens on first press and stays warm; between presses the mic track is disabled, and each press sends `input_audio_buffer.clear` first. Release waits 200 ms for the speech tail, mutes, sends `input_audio_buffer.commit` and waits for `conversation.item.input_audio_transcription.completed` for that item (8 s timeout falls back to the partial). Keywords are refreshed with `session.update` when the scene changes.
- **Web Speech engine** (`voice/webspeech.ts`): fresh recognition per press. No phrase hints: Chrome fails with `phrases-not-supported` unless recognition is on-device.
- **Push-to-talk** (`voice/controller.ts`): idle → connecting → listening → transcribing → idle. Taps under 250 ms are discarded, a release during connect stops as soon as the engine is ready, presses while the agent is busy are ignored. Hold Space (when not typing) or hold the mic button; window blur releases.
- **Latency:** `runCommand(text, { speechEndedAt })` records transcript time and speech-end-to-first-change; the dev overlay shows both.
- The Claude desktop Browser pane blocks microphones; test voice in a real browser.

## Layout solver

- `layout/solver.ts#solvePlacements` is pure and seeded. Candidates come from positional relations, are scored against all relations, penalised for overlaps (spatial hash), leaving the world, standing in a lake (unless `aquatic`) or on a path, with a small bonus for being in view. y snaps to the carved terrain, the target's top for `on_top_of`, or the water level for aquatic items.
- Paths are polyline anchors: `near` / `next_to` / `along_edge_of` / `around` a path place items beside it, alternating sides for groups.
- left/right/in front/behind are relative to the camera's view direction.
- `followMovedAnchors` carries dependants along when an anchor moves or resizes and re-aims `facing`.
- Region `size`: circle = [diameter, _, _], rect = [width, _, depth], ring = [outer diameter, _, inner diameter].

## Coordinate conventions

- Metres, Y up. Terrain is `TERRAIN_SIZE` (240 m) square, centred on the origin.
- `transform.position` is **absolute world space** at the node's **bottom-centre**. A node standing on the ground has `y = heightAt(x, z)` where `heightAt = getWorldHeightField(world)` (lakes carved in). Use `getHeightField` only for the uncarved base.
- Primitives are unit-sized with a bottom-centre pivot, so `scale` is the size in metres.
- Every terrain type is flat at y = 0 within `FLAT_RADIUS` (16 m) of the origin.
- Lakes: procedural nodes, `params.radius`; the bowl reaches back to natural terrain at `SHORE_FACTOR` (1.35) x radius; water sits 0.35 m below the uncarved centre height. Adding a lake pushes existing objects out of the water.
- Sun: `render/sun.ts`. Rises east (+x) at 5:30, overhead at 12:00, sets west (-x) at 18:30, tilted towards +z (the default camera side). A dim blue moon light fades in at night.

## Evals

- `pnpm evals` runs `evals/cases/*.json` against real Claude with the exact app request, headless store + solver, asset search mocked (`agent/test-helpers.ts`). Checks are declarative (`evals/checks.ts`). Target pass rate 85%. Results (pass, tool validity, tool calls, latency, tokens, cost, model) go to `evals/results/`.
- Baseline (Phase 2, 10 cases): 100% pass, 100% valid tool calls, 2.3 tool calls/command, median 1.7 s to first change and 2.9 s per command, $0.085 per run.
- `pnpm test` skips evals; vitest `--mode evals` (or `EVALS=1`) enables them.

## Decisions log

- **TypeScript 6.0.3, not 7.** TS 7 (Go port) has no JS compiler API yet; typescript-eslint 8.x needs it (peer `<6.1.0`).
- **ESLint 9.39, not 10.** `eslint-plugin-react` (via eslint-config-next 16.4) only supports ESLint up to 9.7+.
- **React pinned to 19.3.x.** R3F 9.8 peer range is `>=19 <19.4`.
- **Immer used directly, not zustand's immer middleware**, because the middleware doesn't expose patches.
- **No partial-JSON dependency.** The SDK's own stream reader parses partial tool input; Phase 4 ghosts will use that.
- **Model:** Sonnet 5.5 (`claude-sonnet-5-5`) at effort `low` with adaptive thinking (Sonnet 5.5 rejects `thinking: disabled` and forced `tool_choice`). Server-side refusal fallback on (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), so the beta Messages API and Beta types are used throughout. Haiku 5.5 routing arrives in Phase 4.
- **Prompt caching:** `cache_control` on the system block caches tools + system. Keep both byte-identical between requests. The server logs `cache_read` per request.
- **Kenney kits:** Nature, Holiday and Survival (CC0). The Holiday Kit's cabin is modular pieces, so cabins/houses come from Poly Pizza.
- **Fog guidance:** densities are tuned to scene scale (0.012 misty); exp2 fog hides beyond ~0.85/density metres.
- **Speech to text:** OpenAI `gpt-live-transcribe` (the docs' recommended streaming model) over WebRTC. No `audio.format` in the session (WebRTC negotiates it in SDP) and no `delay` (the docs conflict on support). Raw `fetch`, no OpenAI SDK dependency. The local Whisper engine (Transformers.js) is not built: optional in the brief, needs a new dependency and is slow on a CPU-only laptop.
- **Styling:** Tailwind v4, `glass` utility for overlays.
- **Dev affordances:** `window.__scene` and `window.__interaction` expose the stores; DevPanel (top right) for manual edits; DevOverlay (top left) shows fps, draw calls, triangles, DPR and the last command's timings. drei `PerformanceMonitor` lowers DPR (0.75-1.75) when frame rate drops.

## Known issues

- pnpm reports "Ignored build scripts: unrs-resolver". It ships prebuilt binaries, so lint works without approving it.
- `next/font/google` fetches Inter at build time; offline builds fall back to system fonts.
- Rate limiters and asset caches are per server instance (fine for dev; revisit for Vercel in Phase 7).
- Stars mount/unmount rather than fade. Rivers, rain and snow renderers are not built yet (schema allows them).
- Frame rate measured in a hidden/background browser pane is throttled and meaningless; check fps with the page visible.
