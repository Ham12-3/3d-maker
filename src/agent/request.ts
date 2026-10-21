import type Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsBase } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AGENT_EFFORT, AGENT_MAX_TOKENS, AGENT_MODEL } from "./config";
import { SYSTEM_PROMPT } from "./system-prompt";
import { toolDefinitions } from "./tools";

/**
 * The exact Claude request for an agent turn. Shared by the /api/agent route
 * and the eval harness so evals measure what users get. Built from constants
 * only, so the cached prefix (tools + system) is byte-identical every time.
 */

const TOOLS = toolDefinitions();
const SYSTEM: Anthropic.Beta.BetaTextBlockParam[] = [
  { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
];

export function agentRequest(messages: Anthropic.Beta.BetaMessageParam[]): MessageCreateParamsBase {
  return {
    model: AGENT_MODEL,
    max_tokens: AGENT_MAX_TOKENS,
    system: SYSTEM,
    tools: TOOLS,
    messages,
    output_config: { effort: AGENT_EFFORT },
    // Re-run on another model server-side if a safety classifier declines.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
}
