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
  /**
   * The user's accountId, if they belong to an account. Populated by
   * each agent's run() function at start-up so tools can scope reads
   * account-wide instead of user-only where appropriate — e.g. in a
   * claimed Slack channel the agent sees ALL account members' coaching
   * sessions, not just the channel owner's. null for legacy solo
   * users; tools fall back to userId-scoped queries in that case.
   */
  accountId?: string | null;
}

export interface ToolEntry {
  definition: ChatCompletionTool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, ctx: ToolContext) => Promise<unknown>;
}
