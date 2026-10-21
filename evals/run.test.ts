import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isProfileName, type ProfileName } from "@/agent/config";
import { runAgentTurn } from "@/agent/loop";
import { agentRequest } from "@/agent/request";
import { mockSearchAllAssets, mockSearchAssets } from "@/agent/test-helpers";
import type { RecordedStep } from "@/agent/tools/types";
import type { Vec3 } from "@/scene/schema";
import { createSceneStore } from "@/scene/store";
import { runCheck, type Check } from "./checks";
import { baseWorld } from "./worlds";

/**
 * Eval suite: real Claude calls against the headless store + solver, with
 * asset search mocked. Costs money (~$0.01-0.02 per case), so it is skipped
 * by `pnpm test` and only runs with:
 *   pnpm evals
 * Prints a table and saves evals/results/<timestamp>.json.
 */

type Case = {
  name: string;
  world: string;
  command: string;
  selection?: string;
  pointer?: Vec3;
  /** Commands run first (not measured), e.g. build something and save it. */
  setup?: string[];
  assert: Check[];
};

type Row = {
  case: string;
  pass: boolean;
  checks: string;
  toolCalls: number;
  validToolCalls: number;
  iterations: number;
  firstChangeMs: number | null;
  firstVisibleMs: number | null;
  escalated: string | null;
  totalMs: number;
  inputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  outputTokens: number;
  costUsd: number;
  models: string;
  error?: string;
};

// Prices per million tokens (cache writes 1.25x input, reads 0.1x).
const PRICES: Record<
  string,
  { input: number; cacheWrite: number; cacheRead: number; output: number }
> = {
  "claude-sonnet-5-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
};
const PASS_TARGET = 0.85;
// What to evaluate: the app's routing (default) or one fixed profile, e.g. EVAL_PROFILE=haiku pnpm evals
const PROFILE: "routed" | ProfileName = isProfileName(process.env.EVAL_PROFILE)
  ? process.env.EVAL_PROFILE
  : "routed";

function costOf(model: string, u: Anthropic.Beta.BetaUsage): number {
  const p = PRICES[model] ?? PRICES["claude-sonnet-5-5"]!;
  return (
    ((u.input_tokens ?? 0) * p.input +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u.output_tokens ?? 0) * p.output) /
    1e6
  );
}

const CASES_DIR = join(__dirname, "cases");
const cases: Case[] = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), "utf8")) as Case);

// `pnpm evals` runs vitest with --mode evals; EVALS=1 also works where the shell allows it.
const enabled = Boolean(process.env.EVALS) || import.meta.env.MODE === "evals";
if (enabled) {
  try {
    process.loadEnvFile(join(__dirname, "..", ".env.local"));
  } catch {
    // Fall back to the environment.
  }
}

describe.skipIf(!enabled)("evals", () => {
  const rows: Row[] = [];
  const client = enabled ? new Anthropic() : null;

  for (const c of cases) {
    it(c.name, { timeout: 180_000 }, async () => {
      const store = createSceneStore(baseWorld(c.world));
      let previousTurn: { command: string; steps: RecordedStep[] } | null = null;
      for (const command of c.setup ?? []) {
        const setup = await runAgentTurn(command, {
          routing: PROFILE,
          request: async (messages, { signal, profile }) =>
            client!.beta.messages
              .stream(agentRequest(messages, profile), { signal })
              .toReadableStream() as ReadableStream<Uint8Array>,
          store,
          context: { selection: null, pointer: null, camera: store.getState().world.camera },
          moveCamera: () => {},
          say: () => {},
          searchAssets: mockSearchAssets,
          searchAllAssets: mockSearchAllAssets,
          previousTurn,
          seed: 7,
        });
        if (setup.recorded?.length) previousTurn = { command, steps: setup.recorded };
      }
      const before = store.getState().world;
      const usage: { model: string; u: Anthropic.Beta.BetaUsage }[] = [];
      const models = new Set<string>();
      let valid = 0;

      const result = await runAgentTurn(c.command, {
        routing: PROFILE,
        request: async (messages, { signal, profile }) => {
          const stream = client!.beta.messages.stream(agentRequest(messages, profile), { signal });
          stream.on("finalMessage", (m) => {
            usage.push({ model: m.model, u: m.usage });
            models.add(m.model);
          });
          return stream.toReadableStream() as ReadableStream<Uint8Array>;
        },
        store,
        context: {
          selection: c.selection ?? null,
          pointer: c.pointer ?? null,
          camera: before.camera,
        },
        moveCamera: () => {},
        say: () => {},
        searchAssets: mockSearchAssets,
        searchAllAssets: mockSearchAllAssets,
        previousTurn,
        onToolResult: (_, r) => {
          if (!r.isError) valid++;
        },
        seed: 7,
      });

      const after = store.getState().world;
      const checks =
        result.status === "done" ? c.assert.map((a) => ({ a, r: runCheck(a, before, after) })) : [];
      const pass = result.status === "done" && checks.every((x) => x.r.pass);
      const sum = (k: keyof Anthropic.Beta.BetaUsage) =>
        usage.reduce((s, x) => s + (Number(x.u[k]) || 0), 0);
      const tokens = {
        input: sum("input_tokens"),
        cacheRead: sum("cache_read_input_tokens"),
        cacheWrite: sum("cache_creation_input_tokens"),
        output: sum("output_tokens"),
      };
      rows.push({
        case: c.name,
        pass,
        checks: checks
          .map((x) => `${x.r.pass ? "ok" : "FAIL"} ${x.a.check}: ${x.r.detail}`)
          .join(" | "),
        toolCalls: result.toolCalls,
        validToolCalls: valid,
        iterations: result.iterations,
        firstChangeMs: result.firstChangeMs ?? null,
        firstVisibleMs: result.firstVisibleMs ?? null,
        escalated: result.escalated ?? null,
        totalMs: Math.round(result.totalMs),
        inputTokens: tokens.input,
        cacheRead: tokens.cacheRead,
        cacheWrite: tokens.cacheWrite,
        outputTokens: tokens.output,
        costUsd: usage.reduce((s, x) => s + costOf(x.model, x.u), 0),
        models: [...models].join(","),
        ...(result.error ? { error: result.error } : {}),
      });
      // Individual cases don't fail the run; the pass rate below does.
      expect(result.status).not.toBe("cancelled");
    });
  }

  afterAll(() => {
    if (rows.length === 0) return;
    const passed = rows.filter((r) => r.pass).length;
    const tools = rows.reduce((s, r) => s + r.toolCalls, 0);
    const summary = {
      date: new Date().toISOString(),
      profile: PROFILE,
      cases: rows.length,
      passRate: passed / rows.length,
      validToolCallRate: tools ? rows.reduce((s, r) => s + r.validToolCalls, 0) / tools : 1,
      avgToolCalls: tools / rows.length,
      medianTotalMs: median(rows.map((r) => r.totalMs)),
      medianFirstChangeMs: median(
        rows.flatMap((r) => (r.firstChangeMs === null ? [] : [r.firstChangeMs])),
      ),
      medianFirstVisibleMs: median(
        rows.flatMap((r) => (r.firstVisibleMs === null ? [] : [r.firstVisibleMs])),
      ),
      escalations: rows.filter((r) => r.escalated).length,
      totalCostUsd: rows.reduce((s, r) => s + r.costUsd, 0),
      models: [...new Set(rows.flatMap((r) => r.models.split(",")))],
    };
    console.table(
      rows.map((r) => ({
        case: r.case,
        pass: r.pass ? "PASS" : "FAIL",
        tools: `${r.validToolCalls}/${r.toolCalls}`,
        trips: r.iterations,
        "first ms": r.firstChangeMs ? Math.round(r.firstChangeMs) : "-",
        "total ms": r.totalMs,
        "cost $": r.costUsd.toFixed(4),
      })),
    );
    for (const r of rows.filter((x) => !x.pass))
      console.log(`FAIL ${r.case}: ${r.error ?? r.checks}`);
    console.log(summary);

    const dir = join(__dirname, "results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${summary.date.replace(/[:.]/g, "-")}.json`),
      JSON.stringify({ summary, rows }, null, 2),
    );
  });

  it("meets the pass-rate target", () => {
    // Runs last (vitest runs tests in order); rows is filled by then.
    const passRate = rows.filter((r) => r.pass).length / Math.max(rows.length, 1);
    expect(passRate).toBeGreaterThanOrEqual(PASS_TARGET);
  });
});

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)]!);
}
