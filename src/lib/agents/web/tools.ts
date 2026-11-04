import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ToolEntry } from "@/lib/agents/shared/types";
import { DEAL_TOOLS } from "@/lib/agents/deals/tools";
import { COACHING_TOOLS } from "@/lib/agents/coaching/tools";
import { GTM_TOOLS } from "@/lib/agents/gtm/tools";

/**
 * Tool registry for the unified WEB agent — the one that powers the
 * main /chat surface when "Agent mode" is toggled on. Composes the
 * full union of tools the three Slack agents expose:
 *
 *   - Per-deal tools from DEAL_TOOLS (findDeal, getDealCore, ...)
 *   - Per-coaching-session tools from COACHING_TOOLS
 *   - Everything GTM_TOOLS exposes (already includes pipeline, maturity,
 *     coaching state, personal-data tools, playbook RAG, full account
 *     context).
 *
 * Tools shared across multiple registries (e.g. getMaturityStage,
 * listPipeline) only appear once — we dedupe by tool name and prefer
 * the GTM_TOOLS version, which already canonicalizes the shared
 * handlers via the shared-types pattern.
 */

function composeRegistry(): Record<string, ToolEntry> {
  const out: Record<string, ToolEntry> = {};
  // GTM first: it's the broadest, and its delegated entries (e.g.
  // getMaturityStage → COACHING_TOOLS.getMaturityStage) are the
  // canonical reference.
  for (const [name, entry] of Object.entries(GTM_TOOLS)) {
    out[name] = entry;
  }
  // Per-deal tools — DEAL_TOOLS includes both the per-deal tools and
  // the pipeline-wide tools. The pipeline tools are already re-exported
  // through GTM_TOOLS so they'd skip the assignment below. The per-deal
  // tools (findDeal, getDealCore, ...) fill in the gap.
  for (const [name, entry] of Object.entries(DEAL_TOOLS)) {
    if (!(name in out)) out[name] = entry;
  }
  // Per-coaching-session tools — same logic. The shared handlers
  // (getMaturityStage, getMaturityAssessment, getLatestSalesMetrics,
  // getFullCoachingHistory) are already in GTM_TOOLS; what's left here
  // is the per-session surface (findCoachingSession, getCoachingSession,
  // summarizeCoachingSession, whereDidWeLeaveOff, searchCoachingHistory,
  // addCoachingNote, etc.).
  for (const [name, entry] of Object.entries(COACHING_TOOLS)) {
    if (!(name in out)) out[name] = entry;
  }
  return out;
}

export const WEB_TOOLS: Record<string, ToolEntry> = composeRegistry();

export function getToolDefinitions(): ChatCompletionTool[] {
  return Object.values(WEB_TOOLS).map((t) => t.definition);
}
