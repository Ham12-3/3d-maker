import type Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsBase } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  AGENT_MAX_TOKENS,
  DEFAULT_PROFILE,
  PROFILES,
  isFastProfile,
  type ProfileName,
} from "./config";
import { SYSTEM_PROMPT } from "./system-prompt";
import { FAST_TOOLS, toolDefinitions } from "./tools";

/**
 * The exact Claude request for an agent turn. Shared by the /api/agent route
 * and the eval harness so evals measure what users get. Built from constants
 * only, so the cached prefix (tools + system) is byte-identical every time
 * for a given profile (caches are per model).
 */

const TOOLS = toolDefinitions();
const FAST = toolDefinitions(FAST_TOOLS);
const SYSTEM: Anthropic.Beta.BetaTextBlockParam[] = [
  { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
];

export function agentRequest(
  messages: Anthropic.Beta.BetaMessageParam[],
  profileName: ProfileName = DEFAULT_PROFILE,
): MessageCreateParamsBase {
  const profile = PROFILES[profileName];
  return {
    model: profile.model,
    max_tokens: AGENT_MAX_TOKENS,
    system: SYSTEM,
    tools: isFastProfile(profileName) ? FAST : TOOLS,
    messages,
    output_config: { effort: profile.effort },
    // "between_tools" is newer than the SDK's thinking types.
    ...("thinking" in profile
      ? { thinking: profile.thinking as MessageCreateParamsBase["thinking"] }
      : {}),
    ...(profile.fallbacks
      ? {
          // Re-run on another model server-side if a safety classifier declines.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default" as const,
        }
      : {}),
  };
}
