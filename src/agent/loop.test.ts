import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { loadDefaultWorld } from "@/scene/defaults";
import { createSceneStore } from "@/scene/store";
import { runAgentTurn, type AgentDeps } from "./loop";
import { mockSearchAllAssets, mockSearchAssets } from "./test-helpers";

type Block = { tool: string; input: unknown; id?: string } | { text: string };

/** Build an NDJSON event stream in the shape the SDK's toReadableStream() produces. */
function fakeResponse(blocks: Block[], stopReason: string): ReadableStream<Uint8Array> {
  const events: unknown[] = [
    {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
  ];
  blocks.forEach((block, index) => {
    if ("text" in block) {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: block.text },
      });
    } else {
      events.push({
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id: block.id ?? `toolu_${index}`,
          name: block.tool,
          input: {},
        },
      });
      // Split the JSON in two to exercise partial-JSON accumulation.
      const json = JSON.stringify(block.input);
      const mid = Math.floor(json.length / 2);
      for (const part of [json.slice(0, mid), json.slice(mid)]) {
        events.push({
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: part },
        });
      }
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 42 },
  });
  events.push({ type: "message_stop" });

  const bytes = new TextEncoder().encode(events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function setup(responses: ReadableStream<Uint8Array>[]) {
  const store = createSceneStore(loadDefaultWorld());
  const requests: Anthropic.Beta.BetaMessageParam[][] = [];
  const profiles: string[] = [];
  const said: string[] = [];
  const activity: string[] = [];
  const deps: AgentDeps = {
    request: async (messages, { profile }) => {
      requests.push(structuredClone(messages));
      profiles.push(profile);
      const next = responses.shift();
      if (!next) throw new Error("no more fake responses");
      return next;
    },
    store,
    context: { selection: null, pointer: null, camera: store.getState().world.camera },
    moveCamera: () => {},
    say: (t) => said.push(t),
    searchAssets: mockSearchAssets,
    searchAllAssets: mockSearchAllAssets,
    onActivity: (a) => activity.push(a),
    seed: 3,
  };
  return { store, deps, requests, profiles, said, activity };
}

describe("model routing", () => {
  it("starts on the fast model and redoes the turn on the main model after escalate", async () => {
    const { store, deps, profiles, requests } = setup([
      // Fast model: escalates, but (against instructions) also starts building.
      fakeResponse(
        [
          { tool: "escalate", input: { reason: "multi-building village" } },
          { tool: "add_objects", input: { objects: [{ name: "stray box", shape: "box" }] } },
        ],
        "tool_use",
      ),
      // Main model builds the real thing.
      fakeResponse(
        [
          { tool: "add_objects", input: { objects: [{ name: "well", shape: "cylinder" }] } },
          { tool: "say", input: { text: "Village started." } },
        ],
        "tool_use",
      ),
    ]);
    const before = store.getState().world;
    const result = await runAgentTurn("build a cosy village", deps);

    expect(profiles).toEqual(["haiku", "sonnet"]);
    expect(result).toMatchObject({
      status: "done",
      model: "claude-sonnet-5-5",
      escalated: "multi-building village",
    });
    const world = store.getState().world;
    expect(world.nodes.stray_box_1).toBeUndefined();
    expect(world.nodes.well_1).toBeDefined();
    // The main model starts fresh from the original request.
    expect(requests[1]).toEqual(requests[0]);
    // Still one undo step that restores the start.
    store.getState().undo();
    expect(store.getState().world).toEqual(before);
  });

  it("stays on the fast model when it doesn't escalate, and can be pinned to one profile", async () => {
    const fast = setup([
      fakeResponse([{ tool: "set_environment", input: { timeOfDay: 22 } }], "end_turn"),
    ]);
    const r1 = await runAgentTurn("make it night", fast.deps);
    expect(fast.profiles).toEqual(["haiku"]);
    expect(r1.model).toBe("claude-haiku-5-5");
    expect(r1.firstVisibleMs).toBeDefined();

    const pinned = setup([
      fakeResponse([{ tool: "set_environment", input: { timeOfDay: 22 } }], "end_turn"),
    ]);
    await runAgentTurn("make it night", { ...pinned.deps, routing: "sonnet" });
    expect(pinned.profiles).toEqual(["sonnet"]);
  });
});

describe("agent loop", () => {
  it("runs the sunset + red box next to blue sphere turn as one undo step", async () => {
    const { store, deps, requests, said } = setup([
      fakeResponse(
        [
          {
            tool: "set_environment",
            input: { timeOfDay: 18, sky: "sunset", fog: { enabled: true, color: "#e9a07c" } },
          },
          {
            tool: "add_objects",
            input: {
              objects: [
                {
                  id: "blue_sphere_1",
                  name: "blue sphere",
                  shape: "sphere",
                  material: { color: "#3b6fd8" },
                },
                {
                  name: "red box",
                  shape: "box",
                  material: { color: "#d64545" },
                  relations: [{ predicate: "next_to", target: "blue_sphere_1" }],
                },
              ],
            },
          },
          { tool: "say", input: { text: "Sunset with fog, box beside the sphere." } },
        ],
        "tool_use",
      ),
    ]);
    const before = store.getState().world;

    const result = await runAgentTurn(
      "make it sunset with fog, put a red box next to a blue sphere",
      deps,
    );

    // All tools succeeded and Claude signed off with say: no second round trip.
    expect(result).toMatchObject({ status: "done", toolCalls: 3, iterations: 1 });
    expect(requests).toHaveLength(1);
    expect(result.firstChangeMs).toBeDefined();
    const world = store.getState().world;
    expect(world.environment).toMatchObject({ timeOfDay: 18, sky: "sunset" });
    expect(world.environment.fog.enabled).toBe(true);
    expect(world.nodes.red_box_1?.relations[0]?.target).toBe("blue_sphere_1");
    expect(said).toEqual(["Sunset with fog, box beside the sphere."]);

    // The request carries the scene summary and the command.
    expect(requests[0]![0]!.content).toMatch(/^ENV: time 12\.0/);
    expect(requests[0]![0]!.content).toMatch(/COMMAND: make it sunset/);

    // One undo reverts the whole turn.
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().world).toEqual(before);
  });

  it("returns every tool result in one message when Claude has not signed off", async () => {
    const { deps, requests } = setup([
      fakeResponse(
        [
          { tool: "set_environment", input: { timeOfDay: 22, stars: true } },
          { tool: "add_objects", input: { objects: [{ name: "lamp", shape: "cylinder" }] } },
        ],
        "tool_use",
      ),
      fakeResponse([], "end_turn"),
    ]);
    const result = await runAgentTurn("night with a lamp", deps);
    expect(result).toMatchObject({ status: "done", toolCalls: 2, iterations: 2 });
    const results = requests[1]![2]!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results.map((r) => r.tool_use_id)).toEqual(["toolu_0", "toolu_1"]);
    expect(results.every((r) => !r.is_error)).toBe(true);
  });

  it("still sends results back when a tool failed, even after say", async () => {
    const { deps, requests } = setup([
      fakeResponse(
        [
          { tool: "remove_objects", input: { ids: ["ghost_1"] } },
          { tool: "say", input: { text: "Removed it." } },
        ],
        "tool_use",
      ),
      fakeResponse([], "end_turn"),
    ]);
    const result = await runAgentTurn("remove the ghost", deps);
    expect(result.iterations).toBe(2);
    const results = requests[1]![2]!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results[0]?.is_error).toBe(true);
  });

  it("sends validation errors back to Claude so it can fix them", async () => {
    const { store, deps, requests } = setup([
      fakeResponse(
        [{ tool: "add_objects", input: { objects: [{ name: "pyramid", shape: "pyramid" }] } }],
        "tool_use",
      ),
      fakeResponse(
        [{ tool: "add_objects", input: { objects: [{ name: "pyramid", shape: "cone" }] } }],
        "tool_use",
      ),
      fakeResponse([], "end_turn"),
    ]);
    const result = await runAgentTurn("add a pyramid", deps);
    expect(result.status).toBe("done");
    const first = (requests[1]![2]!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0]!;
    expect(first.is_error).toBe(true);
    expect(first.content).toMatch(/Invalid input for add_objects/);
    expect(store.getState().world.nodes.pyramid_1?.primitive).toBe("cone");
  });

  it("rolls back everything on a refusal", async () => {
    const { store, deps } = setup([
      fakeResponse([{ tool: "set_environment", input: { timeOfDay: 2 } }], "refusal"),
    ]);
    const before = store.getState().world;
    const result = await runAgentTurn("something", deps);
    expect(result.status).toBe("error");
    expect(store.getState().world).toEqual(before);
    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().transaction).toBeNull();
  });

  it("rolls back when the request fails", async () => {
    const { store, deps } = setup([]);
    const result = await runAgentTurn("anything", deps);
    expect(result).toMatchObject({ status: "error", error: "no more fake responses" });
    expect(store.getState().transaction).toBeNull();
  });

  it("stops after the iteration cap without sending more results", async () => {
    const env = (t: number) =>
      fakeResponse([{ tool: "set_environment", input: { timeOfDay: t } }], "tool_use");
    const { store, deps, requests } = setup([env(1), env(2), env(3), env(4)]);
    const result = await runAgentTurn("keep going", deps);
    expect(result).toMatchObject({ status: "done", iterations: 3, toolCalls: 3 });
    expect(requests).toHaveLength(3);
    expect(store.getState().world.environment.timeOfDay).toBe(3);
    expect(store.getState().past).toHaveLength(1);
  });
});
