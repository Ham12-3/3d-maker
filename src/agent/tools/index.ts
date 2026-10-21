import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { addObjectsTool } from "./add-objects";
import { addProceduralTool } from "./add-procedural";
import { createRegionTool } from "./create-region";
import { escalateTool } from "./escalate";
import { applyMacroTool, saveMacroTool } from "./macro-tools";
import { captureViewTool } from "./capture-view";
import { removeObjectsTool } from "./remove-objects";
import { sayTool } from "./say";
import { searchAssetsTool } from "./search-assets";
import { setCameraTool } from "./set-camera";
import { setEnvironmentTool } from "./set-environment";
import type { AgentTool, ToolContext, ToolImage } from "./types";
import { updateObjectsTool } from "./update-objects";

/** Fixed order: the tool list is part of the cached prompt prefix. */
export const TOOLS: readonly AgentTool[] = [
  setEnvironmentTool,
  addProceduralTool,
  addObjectsTool,
  updateObjectsTool,
  removeObjectsTool,
  createRegionTool,
  searchAssetsTool,
  saveMacroTool,
  applyMacroTool,
  captureViewTool,
  setCameraTool,
  sayTool,
] as AgentTool[];

/** The fast model also gets `escalate` (last, so the shared tools keep their order). */
export const FAST_TOOLS: readonly AgentTool[] = [...TOOLS, escalateTool as AgentTool];

const byName = new Map(FAST_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): AgentTool | undefined {
  return byName.get(name);
}

/** Claude tool definitions, generated from the zod schemas (one source of truth). */
export function toolDefinitions(tools: readonly AgentTool[] = TOOLS): Anthropic.Beta.BetaTool[] {
  return tools.map((tool) => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.input, { io: "input" }) as Record<
      string,
      unknown
    >;
    return {
      name: tool.name,
      description: tool.description,
      input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
      ...(tool.eagerInputStreaming ? { eager_input_streaming: true } : {}),
    };
  });
}

export type ToolCallResult = {
  isError: boolean;
  content: string;
  activity: string;
  /** Screenshots (capture_view) go back to Claude as image blocks. */
  images?: ToolImage[];
};

/** Tools whose successful calls are recorded for macros (they build things). */
const RECORDED = new Set(["set_environment", "add_procedural", "add_objects", "create_region"]);

/** Validate raw (possibly partial-JSON-parsed) input against the schema, then run the tool. */
export async function executeToolCall(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const tool = getTool(name);
  if (!tool) return { isError: true, content: `Unknown tool "${name}"`, activity: "" };

  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    return {
      isError: true,
      content: `Invalid input for ${name}:\n${z.prettifyError(parsed.error)}\nReceived: ${JSON.stringify(rawInput)}`,
      activity: "",
    };
  }
  try {
    const before = ctx.getWorld();
    const outcome = await tool.execute(parsed.data, ctx);
    if (outcome.ok && ctx.recorder && RECORDED.has(name)) {
      const after = ctx.getWorld();
      ctx.recorder.push({
        tool: name,
        input: parsed.data,
        created: Object.keys(after.nodes).filter((id) => !(id in before.nodes)),
        regions: Object.keys(after.regions).filter((id) => !(id in before.regions)),
      });
    }
    return outcome.ok
      ? {
          isError: false,
          content: outcome.result,
          activity: outcome.activity,
          ...(outcome.images ? { images: outcome.images } : {}),
        }
      : { isError: true, content: outcome.error, activity: "" };
  } catch (err) {
    return { isError: true, content: `${name} failed: ${(err as Error).message}`, activity: "" };
  }
}
