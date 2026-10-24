# Speakworld

Voice-driven 3D world builder. You talk, Claude edits a JSON scene graph through typed tools, and React Three Fiber renders it. The full product brief lives in the original build prompt; this file holds what a new session needs to work in the repo.

## Commands

```bash
pnpm dev          # Next.js dev server on http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint (flat config)
pnpm test         # vitest run (unit tests; evals are skipped)
pnpm evals        # real Claude eval suite (a few cents a run), writes evals/results/<timestamp>.json
pnpm test:e2e     # Playwright smoke test against `pnpm start` (run `pnpm build` first); Claude is mocked
pnpm format       # prettier --write
pnpm build        # production build
node scripts/curate-kenney.mjs <dir>   # rebuild public/assets/kenney from extracted Kenney zips
node scripts/record-demo.mjs <url> <dir> # record the README demo video (real Claude), then ffmpeg it to docs/demo.gif
```

Before calling a phase done: `pnpm typecheck && pnpm lint && pnpm test` must all pass.

`.env.local` needs `ANTHROPIC_API_KEY` for the agent (without it `/api/agent` returns a clear 500), `POLYPIZZA_API_KEY` for online models (without it objects fall back to primitives) optionally `OPENAI_API_KEY` for the default speech engine (without it voice uses the browser's speech recognition), and `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for share links (without them, shared worlds are saved as files in `.data/`, for `pnpm dev` and `pnpm start`; on Vercel, where files don't persist, sharing answers 503).

## Layout

```
src/
  app/            Next.js App Router
    api/agent/            Claude proxy (streaming)
    api/assets/search/    Poly Pizza search proxy (cached a day)
    api/assets/file/[id]/ Poly Pizza GLB proxy (key stays on the server)
    api/stt/token/        OpenAI speech: GET availability, POST mints a 10-minute client secret
    api/worlds/           POST saves a world for sharing; [id] GET loads, PUT updates (edit token); [id]/thumbnail (dev file store only)
    w/[id]/               read-only share page (Viewer) with Open Graph thumbnail
    v/                    read-only page for a world packed into the link (#world=...)
  agent/          config, system prompt, request builder, summary, client loop, judge, status, macros, tools/
    tools/        One file per tool: zod schema + description + executor; index.ts = registry
  assets/         Kenney catalog + search, Poly Pizza client, GLB normalisation, load status
  layout/         Solver, predicates, regions, spatial hash, scatter (instanced nature), paths
  scene/          World schema, default world, store, ops, terrain (height field + lake/river carving, water queries)
  render/         R3F: Stage, World, Terrain, SkySystem, Sea, Weather, RegionFlash, capture, exporter, nodes/ (Primitive, AssetModel, Scatter, Lake, River, water, PathRibbon, Fireflies), camera/ (shots, director store, CameraRig, recording, RecordFrames)
  share/          Share ids/tokens, WorldRepo (Supabase REST or dev file store), save/update, server loader, browser client
  ui/             CommandBar, Toolbar, TopBar (Polish, Director, Share, Credits), DirectorPanel, ShareMenu, StageFrame, Viewer, Credits, DevPanel, DevOverlay, shortcuts
  voice/          Transcriber interface, OpenAI (WebRTC) and Web Speech engines, push-to-talk controller, useVoice
  lib/            seeded RNG, simplex noise, rate limiter, TTL cache
evals/            cases/*.json, checks, base worlds, run.test.ts, results/
e2e/              Playwright smoke test (smoke.spec.ts)
.github/workflows/ci.yml   checks + build + smoke test on every push/PR; evals on master pushes when the ANTHROPIC_API_KEY secret is set
public/assets/kenney/   curated CC0 GLBs + manifest.json (sizes in metres)
scripts/          curate-kenney.mjs
```

Planned (not built yet): local Whisper engine (optional), autosave of the editor's own world.

## Architecture rules

- **The scene graph is the source of truth.** `World` (in `scene/schema.ts`) is plain JSON. Rendering is a pure function of it. The LLM only edits it through typed tools.
- **One schema source.** Zod schemas in `scene/schema.ts`; TS types are `z.infer`'d from them. Claude tool JSON Schemas are generated from each tool's zod input with `z.toJSONSchema` (`agent/tools/index.ts#toolDefinitions`).
- **All world changes go through `store.edit(label, recipe)`** (`scene/store.ts`). Recipes are Immer producers; reusable ones live in `scene/ops.ts`. Never `setState({ world })` directly except `replaceWorld` (load).
- **Undo/redo = Immer patches.** Each `edit` outside a transaction is one undo step. `beginTransaction` / `commitTransaction` merge every edit in between into one step while still applying them live. `rollbackTransaction` reverts an open transaction. Undo/redo are ignored while a transaction is open; nesting throws.
- **Transient UI state** (selection, pointer hit) lives in `scene/interaction.ts`, outside the world and outside undo. The pointer is cleared after each successful command (a ground click is a one-shot "there").
- **Per-node subscriptions.** `World.tsx` subscribes to node ids; each `NodeView` subscribes to its own node, so Immer structural sharing keeps re-renders local.
- **Animation runs in useFrame, not React state.** `SkySystem` eases every environment value (~1.5 s), `useAnimatedTransform` pops nodes in and eases moves, `Scatter` grows instances in from the centre. Mutate per-frame things through refs (the React Compiler lint rules reject mutating hook-returned objects).
- **Derived, not stored:** forest/rock/grass instance positions, path and river polylines and water-carved terrain are pure functions of the world (`layout/scatter.ts`, `layout/paths.ts`, `scene/terrain.ts#getWorldHeightField`). Renderer, solver, judge and tests all call the same functions.

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
- Tools: `set_environment`, `add_procedural` (forest, rocks, grass, flowers, lake, river, path, fireflies), `add_objects` (`asset_query` / `asset_id` / `shape`), `update_objects`, `remove_objects`, `create_region`, `search_assets`, `save_macro`, `apply_macro`, `capture_view`, `set_camera`, `say`, and `escalate` (fast model only).
- **Model routing** (`agent/config.ts`): profiles `sonnet`, `sonnet-nothink`, `haiku`, `haiku-nothink`; the app runs `ROUTING` = Haiku 5.5 first. Haiku may call `escalate` (first and alone) for multi-part compositions or whole-scene restyles; the loop rolls back anything already done and reruns the command from the original message on Sonnet 5.5. The client sends the profile name to `/api/agent`, which only accepts known names. `TurnResult.model` / `escalated` record who handled it.
- **Streaming previews** (`agent/preview.ts`): all creating tools and `set_environment` use `eager_input_streaming`. On each `inputJson` snapshot only the finished part is used (every key/element but the last): finished `set_environment` fields are applied inside the turn's transaction (the sky starts turning early), and `add_objects` / `add_procedural` show ghost boxes / discs / rings (`render/Ghosts.tsx`) at solved positions until the tool runs. `TurnResult.firstVisibleMs` = first preview or real change.

## Polish, macros, regions

- **Visual critique:** `render/capture.tsx#CaptureBridge` registers `captureView()` (renders the current frame, downscales to 1024 px wide, JPEG 0.82). `capture_view` returns it to Claude as an image tool result. The **Polish** button (`agent/run-command.ts#runPolish`) captures the view and runs a Sonnet turn with `polishPrompt(lastRequest)` plus the image; Polish is its own undo step. **Auto** (TopBar checkbox, `status.autoPolish`) polishes after any turn with 3+ tool calls.
- **Macros** (`agent/macros.ts`): `executeToolCall` records every successful creating call (`set_environment`, `add_procedural`, `add_objects`, `create_region`) with the ids it created into `ctx.recorder`. `save_macro` generalises the current turn's steps, or the previous turn's (`previousTurn` in `run-command.ts`): created ids become `$placeholders`, absolute positions are dropped, and references to things outside the recipe become `$anchor`. Water built in the same command (lakes, rivers, and nature placed around them) is the setting, not the thing: it is left out and becomes the anchor, so "my camp" re-applied by the lake doesn't dig a second lake. `apply_macro` assigns fresh ids, binds `$anchor` to a target (node, region, "pointer"), and replays the steps through `executeToolCall`, so the solver re-places everything. Saved macros live in `world.macros` (undoable, in the summary as `MACROS:`). Built-ins: spooky, cosy_village, tropical_island, winter_wonderland, alien_planet.
- **Regions by voice:** "call this area X" → `create_region` at the pointer. `RegionFlash` outlines a new region and shows its name for 4 s.

## Share, export, Director

- **Supabase project `speakworld`** (eu-west-2, ref `unqecdchprblgxhgyxve`): table `public.worlds` (id, title, world jsonb, thumbnail_url, edit_token_hash, timestamps) with RLS on and no policies, and a public `thumbnails` bucket (JPEG only, 1 MB). Only the Next.js server talks to it, over plain REST (`share/supabase-repo.ts`, no client library) with the secret key; the browser never gets a Supabase key.
- **No database needed:** `GET /api/worlds` says whether the server can store worlds. If not (Vercel without Supabase), `shareWorld()` packs the world into the link instead: deflate-raw + base64url in `/v#world=...` (`share/link.ts`, capped at 60k characters). The fragment never reaches the server; Remix opens it as `/#world=...`.
- **Sharing:** Share → `shareWorld()` saves the world with the live camera and a 1.9:1 thumbnail (`captureView({ aspect })`). The first save returns an edit token, kept in localStorage; sharing again PUTs to the same id (token checked by hash, timing-safe). Without the token (someone else's world) it creates a new link. `/w/<id>` validates the stored JSON with `WorldSchema`, loads it into the store before the Stage mounts, and offers Director and Remix (`/?w=<id>` opens it in the editor).
- **Export:** GLB via `GLTFExporter` of the `world-export` group (terrain, water, nodes, instanced nature as `EXT_mesh_gpu_instancing`); sky, weather, helpers, points and shader materials are hidden for the export, and generated DataTextures (water ripples) are stripped and restored. JSON export/import of the world itself.
- **Director:** shots are pure maths in `render/camera/shots.ts`: establishing, close_up, orbit, flyover (a sweeping pass across the front that keeps the subject in frame), first_person, reveal (crane up and back), push_in. `aspect` makes shots stand further back in a 9:16 frame, but never so far that the camera leaves the terrain (beyond it there is only sky); `cut` moves start on their first frame (recordings). The Director panel frames the view 9:16 (`StageFrame`, same element tree so the Canvas never remounts) and previews or records a shot of the selection or the whole scene.
- **Recording** (`render/camera/recording.ts`): the canvas renders at the video height (`recording.dpr`), `RecordFrames` renders each frame itself (useFrame priority 1) and copies it into an exact 1080x1920 (or 720x1280) 2D canvas, whose `captureStream(30)` goes to MediaRecorder (MP4/H.264 where supported, else WebM). Real time: a slow GPU gives a choppier video, so 720p is offered. "Record a slow flyover" works by voice: `set_camera` with `record: true`.

## Deployment

- **Vercel project `speakworld`** (team ham12-3s-projects), live at https://speakworld-navy.vercel.app. It is connected to GitHub `Ham12-3/3d-maker`: every push to master deploys production, and other branches get previews. No database: on Vercel, sharing uses link-packed worlds.
- Environment variables are set in the Vercel dashboard (`ANTHROPIC_API_KEY`, `POLYPIZZA_API_KEY`, optionally `OPENAI_API_KEY` and the `AGENT_*` limits); a redeploy picks up changes. `vercel link` also wrote `VERCEL_OIDC_TOKEN` into `.env.local` (git-ignored).
- CI: the evals job needs the `ANTHROPIC_API_KEY` repository secret; without it, it skips with a notice.

## Assets

- **Tiers:** bundled Kenney kit first (`assets/catalog.ts#searchKit`, instant, offline, CC0), then Poly Pizza via `/api/assets/search`. A kit model must match the query's head noun ("wooden cabin" never resolves to a fence). No match falls back to a primitive and the tool result says so.
- **Poly Pizza API v1.1:** `https://api.poly.pizza/v1.1/search/{kw}?Limit&License=1` (1 = CC0, 0 = CC-BY), header `x-auth-token`. The token is also required for files on `static.poly.pizza`, so GLBs are served by `/api/assets/file/[id]`, which only ever fetches `https://static.poly.pizza/*.glb`. Animated and >60k-tri models are filtered out. CC-BY attribution is stored on the node and listed in Credits.
- **Size semantics:** an asset node's `transform.scale` is its size box in metres (same as primitives). `AssetModel` normalises the GLB to bottom-centre and scales it uniformly to fit the box. Kit models keep their manifest proportions, scaled uniformly to fit inside the requested box (height alone blew flat models like campfires up sideways); online models fit the requested box.
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
- Lakes: procedural nodes, `params.radius`; the bowl reaches back to natural terrain at `SHORE_FACTOR` (1.35) x radius; water sits 0.35 m below the uncarved centre height. Adding a lake or river pushes existing objects out of the water.
- Rivers: procedural nodes with `params.width` (default 6) and either `from`/`to` (node, region or `x,z`) or a centre + `rotationY` + `length` (default 140, across the view). The channel follows the base terrain, water 0.35 m below it point by point. `scene/terrain.ts#nearestWater` (signed distance, level, way out) is the one water query for solver, scatter, judge and evals; `waterKey` changes exactly when water changes.
- Weather: `environment.weather` rain/snow is a camera-following point box animated in the vertex shader (one draw call). Island terrain gets a sea plane at `SEA_LEVEL` (-0.4).
- Sun: `render/sun.ts`. Rises east (+x) at 5:30, overhead at 12:00, sets west (-x) at 18:30, tilted towards +z (the default camera side). A dim blue moon light fades in at night.

## Evals

- `pnpm evals` runs `evals/cases/*.json` against real Claude with the exact app request, headless store + solver, asset search mocked (`agent/test-helpers.ts`). Checks are declarative (`evals/checks.ts`). Target pass rate 85%. Results (pass, tool validity, tool calls, latency, tokens, cost, model) go to `evals/results/`.
- `EVAL_PROFILE=<profile> pnpm evals` pins one model setup; the default evaluates the app's routing. Cost is priced per response by the model that served it.
- Phase 4 measurements (12 cases incl. a village composition and a whole-scene restyle):

  | setup                | pass                                      | first visible p50 / p90                        | total p50 | cost/run |
  | -------------------- | ----------------------------------------- | ---------------------------------------------- | --------- | -------- |
  | routed (Haiku first) | 12/12, escalated exactly the 2 hard cases | 1.45 s / 2.5 s (simple commands only: ~1.36 s) | 2.1 s     | $0.042   |
  | Sonnet only          | 12/12                                     | 1.44 s / 2.6 s                                 | 4.2 s     | $0.092   |

  Earlier single-profile runs (10 simple cases): Haiku 1.23 s to first change vs Sonnet 1.85 s; Sonnet with `between_tools` was slower (2.34 s), so it is not used.

- Phase 7 run (same 15 cases, after the share/Director tools changed): 15/15, valid tool calls 97%, first visible p50 1.5 s, total p50 1.7 s, 2 escalations, $0.023.
- Phase 5 run (15 cases, adds "save this village, make another by the river", winter wonderland, naming a region; cases may have `setup` commands that run first, chained via `previousTurn`): 15/15, valid tool calls 97%, first visible p50 1.2 s, total p50 2.1 s, 2 escalations, $0.045.
- `pnpm test` skips evals; vitest `--mode evals` (or `EVALS=1`) enables them.

## Decisions log

- **TypeScript 6.0.3, not 7.** TS 7 (Go port) has no JS compiler API yet; typescript-eslint 8.x needs it (peer `<6.1.0`).
- **ESLint 9.39, not 10.** `eslint-plugin-react` (via eslint-config-next 16.4) only supports ESLint up to 9.7+.
- **React pinned to 19.3.x.** R3F 9.8 peer range is `>=19 <19.4`.
- **Immer used directly, not zustand's immer middleware**, because the middleware doesn't expose patches.
- **No partial-JSON dependency.** The SDK's own stream reader parses partial tool input; Phase 4 ghosts will use that.
- **Models:** Haiku 5.5 (`claude-haiku-5-5`, effort `low`, adaptive thinking) first, escalating to Sonnet 5.5 (`claude-sonnet-5-5`, effort `low`, adaptive). Sonnet 5.5 rejects `thinking: disabled` and forced `tool_choice`. Sonnet requests use the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`); Haiku 5.5 has no server-side fallback, so its requests omit it. The beta Messages API and Beta types are used throughout. Caches are per model, so each profile warms its own prefix.
- **Prompt caching:** `cache_control` on the system block caches tools + system. Keep both byte-identical between requests. The server logs `cache_read` per request.
- **Kenney kits:** Nature, Holiday and Survival (CC0). The Holiday Kit's cabin is modular pieces, so cabins/houses come from Poly Pizza.
- **Fog guidance:** densities are tuned to scene scale (0.012 misty); exp2 fog hides beyond ~0.85/density metres.
- **Speech to text:** OpenAI `gpt-live-transcribe` (the docs' recommended streaming model) over WebRTC. No `audio.format` in the session (WebRTC negotiates it in SDP) and no `delay` (the docs conflict on support). Raw `fetch`, no OpenAI SDK dependency. The local Whisper engine (Transformers.js) is not built: optional in the brief, needs a new dependency and is slow on a CPU-only laptop.
- **Styling:** Tailwind v4, `glass` utility for overlays.
- **Dev affordances:** `window.__scene` and `window.__interaction` expose the stores; DevPanel (top right) for manual edits; DevOverlay (top left) shows fps, draw calls, triangles, DPR and the last command's timings. drei `PerformanceMonitor` lowers DPR (0.75-1.75) when frame rate drops.

## Known issues

- pnpm reports "Ignored build scripts: unrs-resolver". It ships prebuilt binaries, so lint works without approving it.
- `next/font/google` fetches Inter at build time; offline builds fall back to system fonts.
- Rate limiters and asset caches are per server instance (no shared store). `/api/agent` has three layers: 30/min and `AGENT_DAILY_LIMIT_PER_IP` (300)/day per IP, plus `AGENT_HOURLY_LIMIT` (2000)/hour across everyone on the instance; `AGENT_DISABLED=1` switches it off. Saves are limited to 10/min per IP. Set a spend limit in the Anthropic console too.
- Link-packed shares have no preview image (the server never sees the world).
- Thumbnails can't be larger than the canvas, so in a small window the link preview is under 1200 px wide.
- Shared worlds can't be deleted from the app yet.
- Stars mount/unmount rather than fade.
- The island sea is only rendered; the solver and judge don't treat it as water (the island shore keeps most placements dry anyway).
- Frame rate measured in a hidden/background browser pane is throttled and meaningless; check fps with the page visible.
