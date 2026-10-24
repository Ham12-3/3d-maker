/**
 * Fake Claude responses for tests: the NDJSON event stream that
 * `/api/agent` returns (the SDK's toReadableStream() shape). Used by the loop
 * unit tests and by the Playwright smoke test, which mocks /api/agent.
 */

export type FakeBlock = { tool: string; input: unknown; id?: string } | { text: string };

export function fakeAgentEvents(
  blocks: FakeBlock[],
  stopReason: string,
  model = "claude-sonnet-5-5",
): string {
  const events: unknown[] = [
    {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model,
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
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}
