/** Agent settings shared by the server route, the client loop and the evals. */

/**
 * A model setup for one request. `thinking` omitted means the model's
 * default (adaptive). Sonnet 5.5 turns thinking off with "between_tools"
 * (it rejects "disabled"); Haiku 5.5 accepts "disabled" at effort high or
 * below. Haiku has no server-side refusal fallback, so `fallbacks` is off.
 */
export type AgentProfile = {
  model: string;
  effort: "low" | "medium" | "high";
  thinking?: { type: "disabled" } | { type: "between_tools" };
  fallbacks: boolean;
};

export const PROFILES = {
  sonnet: { model: "claude-sonnet-5-5", effort: "low", fallbacks: true },
  "sonnet-nothink": {
    model: "claude-sonnet-5-5",
    effort: "low",
    thinking: { type: "between_tools" },
    fallbacks: true,
  },
  haiku: { model: "claude-haiku-5-5", effort: "low", fallbacks: false },
  "haiku-nothink": {
    model: "claude-haiku-5-5",
    effort: "low",
    thinking: { type: "disabled" },
    fallbacks: false,
  },
} as const satisfies Record<string, AgentProfile>;

export type ProfileName = keyof typeof PROFILES;

export function isProfileName(name: unknown): name is ProfileName {
  return typeof name === "string" && name in PROFILES;
}

export const DEFAULT_PROFILE: ProfileName = "sonnet";

/**
 * How the app picks models. "routed": every command starts on the fast
 * profile, which may call `escalate` to hand over to the main profile.
 * Measured on the eval suite (Phase 4): Haiku 5.5 alone passed every case
 * with a ~1.2 s median to first change vs ~1.85 s for Sonnet 5.5.
 */
export const ROUTING = { fast: "haiku", main: "sonnet" } as const satisfies Record<
  string,
  ProfileName
>;

/** Profiles that get the `escalate` tool. */
export function isFastProfile(name: ProfileName): boolean {
  return name === ROUTING.fast;
}
export const AGENT_MAX_TOKENS = 16000;

/** Per command: at most this many tool calls and model round trips. */
export const MAX_TOOL_CALLS = 12;
export const MAX_ITERATIONS = 3;
