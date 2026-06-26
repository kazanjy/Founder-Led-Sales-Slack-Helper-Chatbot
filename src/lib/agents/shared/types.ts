import type { ChatCompletionTool } from "openai/resources/chat/completions";

/**
 * Shared types for the Mikey tool-using agents. Each agent module
 * (deals, coaching, gtm) defines its tools as ToolEntry records and
 * exposes them via a name → ToolEntry registry. Tools can then be
 * imported across agents (e.g. the GTM agent reuses the coaching
 * agent's getMaturityStage handler) without duplicating logic.
 */

export interface ToolContext {
  userId: string;
}

export interface ToolEntry {
  definition: ChatCompletionTool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, ctx: ToolContext) => Promise<unknown>;
}
