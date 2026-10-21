/** Agent settings shared by the server route and the client loop. */
export const AGENT_MODEL = "claude-sonnet-5-5";
export const AGENT_EFFORT = "low" as const;
export const AGENT_MAX_TOKENS = 16000;

/** Per command: at most this many tool calls and model round trips. */
export const MAX_TOOL_CALLS = 12;
export const MAX_ITERATIONS = 3;
