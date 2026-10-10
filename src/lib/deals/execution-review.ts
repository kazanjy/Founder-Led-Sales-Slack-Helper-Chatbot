import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { loadSellerContext } from "@/lib/seller-context";
import { assembleDealEvidence } from "@/lib/business-cases/generate";
import { getDealSlackTone } from "./tone-prefs";
import { ACTIVITY_ENTRY_TYPES } from "./constants";

/**
 * Deal Execution Review — the on-demand "what needs my hand right
 * now" sweep. Deterministic data layer (overdue tasks + quiet deals,
 * no LLM cost to open the overlay), then a per-deal proposal call the
 * founder triggers explicitly:
 *
 *   send_message — the deal is worth a nudge; comes with a
 *                  tone-compliant draft grounded in the history
 *   close_lost   — the evidence says it's dead; stop carrying it
 *   wait         — silence is expected (e.g. "they're in board week")
 *
 * This is the manual sibling of the future weekly Pipeline Review.
 */

const QUIET_THRESHOLD_DAYS = 7;

export interface QuietDeal {
  id: string;
  name: string;
  companyName: string | null;
  stage: string;
  status: string;
  daysQuiet: number;
  lastActivityAt: string | null;
  openTaskCount: number;
  overdueTaskCount: number;
  slackChannelId: string | null;
  slackChannelName: string | null;
}

export interface OverdueTaskRow {
  id: string;
  dealId: string;
  title: string;
  dueAt: string | null;
  status: string;
  executeVia: string | null;
  hasDraft: boolean;
  dealName: string;
  companyName: string | null;
}

export interface ExecutionReviewData {
  overdueTasks: OverdueTaskRow[];
  quietDeals: QuietDeal[];
}

const IN_PLAY = ["potential", "likely", "active", "stalled"];

export async function getExecutionReviewData(userId: string): Promise<ExecutionReviewData> {
  const now = Date.now();
  const [deals, lastActivity, overdue, openCounts] = await Promise.all([
    prisma.deal.findMany({
      where: { userId, status: { in: IN_PLAY } },
      select: {
        id: true, name: true, companyName: true, stage: true, status: true,
        slackChannelId: true, slackChannelName: true, createdAt: true,
      },
    }),
    // "Quiet" means no COMMUNICATION — a ✓-done reminder or a note
    // doesn't count as talking to the customer.
    prisma.dealTimelineEntry.groupBy({
      by: ["dealId"],
      where: {
        deal: { userId, status: { in: IN_PLAY } },
        entryDate: { lte: new Date() },
        type: { in: ACTIVITY_ENTRY_TYPES },
      },
      _max: { entryDate: true },
    }),
    prisma.dealTask.findMany({
      where: {
        userId,
        status: { in: ["scheduled", "pinged"] },
        dueAt: { lt: new Date() },
        deal: { status: { in: IN_PLAY } },
      },
      orderBy: { dueAt: "asc" },
      take: 30,
      include: { deal: { select: { name: true, companyName: true } } },
    }),
    prisma.dealTask.groupBy({
      by: ["dealId"],
      where: { userId, status: { in: ["scheduled", "pinged"] } },
      _count: { _all: true },
    }),
  ]);

  const lastById = new Map(lastActivity.map((r) => [r.dealId, r._max.entryDate]));
  const openById = new Map(openCounts.map((r) => [r.dealId, r._count._all]));
  const overdueByDeal = new Map<string, number>();
  for (const t of overdue) {
    overdueByDeal.set(t.dealId, (overdueByDeal.get(t.dealId) || 0) + 1);
  }

  const quietDeals: QuietDeal[] = deals
    .map((d) => {
      // A deal with no entries at all is "quiet since created".
      const last = lastById.get(d.id) || d.createdAt;
      const daysQuiet = Math.floor((now - last.getTime()) / (24 * 60 * 60 * 1000));
      return {
        id: d.id,
        name: d.name,
        companyName: d.companyName,
        stage: d.stage,
        status: d.status,
        daysQuiet,
        lastActivityAt: lastById.get(d.id)?.toISOString() || null,
        openTaskCount: openById.get(d.id) || 0,
        overdueTaskCount: overdueByDeal.get(d.id) || 0,
        slackChannelId: d.slackChannelId,
        slackChannelName: d.slackChannelName,
      };
    })
    .filter((d) => d.daysQuiet >= QUIET_THRESHOLD_DAYS)
    .sort((a, b) => b.daysQuiet - a.daysQuiet);

  const overdueTasks: OverdueTaskRow[] = overdue.map((t) => ({
    id: t.id,
    dealId: t.dealId,
    title: t.title,
    dueAt: t.dueAt?.toISOString() || null,
    status: t.status,
    executeVia: t.executeVia,
    hasDraft: !!t.draftMessage?.trim(),
    dealName: t.deal.name,
    companyName: t.deal.companyName,
  }));

  return { overdueTasks, quietDeals };
}

const PROPOSE_PROMPT = `You are the founder's deal copilot. A deal has gone QUIET — no new activity for a while. Read the deal evidence and recommend ONE action.

Return ONLY a JSON object:
{
  "action": "send_message" | "close_lost" | "wait",
  "rationale": "<2-3 sentences: what the evidence says about why it's quiet and why this action>",
  "taskTitle": "<short imperative title for the follow-up task, e.g. 'Re-engage Dana on the pilot decision'>",
  "message": "<ONLY for send_message: the Slack message the founder would send, in their voice per foundersTonePreference — grounded in the real thread (names, promises, last discussion), 2-5 sentences, no signature, ends with something easy to respond to>"
}

Decision guide:
- send_message: there's a live thread worth nudging — an unanswered promise, a stalled next step, a decision that slipped. The default for deals with real engagement history.
- close_lost: the evidence shows it's over — explicit no, ghosted after multiple nudges, champion gone, clearly disqualified. Recommend this honestly; carrying dead deals costs attention.
- wait: the silence is EXPECTED — the evidence shows an agreed future date not yet reached ("reconnect after their board meeting in March"), or a nudge went out very recently and hasn't had time to land.
- Never invent facts. If the evidence is too thin to judge, prefer send_message with a light, honest check-in.`;

export interface DealActionProposal {
  action: "send_message" | "close_lost" | "wait";
  rationale: string;
  taskTitle: string;
  message: string | null;
}

export async function proposeDealAction(
  userId: string,
  dealId: string
): Promise<DealActionProposal | null> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, userId },
    select: { id: true, name: true, companyName: true, stage: true, status: true },
  });
  if (!deal) return null;

  const [seller, assembled, tone, openTasks, lastEntry] = await Promise.all([
    loadSellerContext(userId),
    assembleDealEvidence(userId, dealId),
    getDealSlackTone(userId),
    prisma.dealTask.findMany({
      where: { dealId, status: { in: ["scheduled", "pinged"] } },
      select: { title: true, dueAt: true, status: true },
    }),
    prisma.dealTimelineEntry.findFirst({
      where: { dealId, type: { in: ACTIVITY_ENTRY_TYPES }, entryDate: { lte: new Date() } },
      orderBy: { entryDate: "desc" },
      select: { entryDate: true },
    }),
  ]);

  const daysQuiet = lastEntry
    ? Math.floor((Date.now() - lastEntry.entryDate.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  const payload = {
    deal: {
      company: deal.companyName || deal.name,
      stage: deal.stage,
      status: deal.status,
      daysSinceLastActivity: daysQuiet ?? "unknown (no entries)",
    },
    openTasks: openTasks.map((t) => ({
      title: t.title,
      due: t.dueAt?.toISOString().slice(0, 10) || null,
      status: t.status,
    })),
    foundersTonePreference: tone.tone,
    foundersValueProp: seller.valueProp100w?.substring(0, 1200) || "(none)",
    todaysDate: new Date().toISOString().slice(0, 10),
    dealEvidence: (assembled?.evidence || "(no evidence yet)").slice(-80_000),
  };
  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      { role: "user", content: `${PROPOSE_PROMPT}\n\n---\n\n${JSON.stringify(payload, null, 2)}` },
    ],
  });
  let parsed: Partial<DealActionProposal>;
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("Action proposal returned unparseable JSON");
  }
  const action =
    parsed.action === "close_lost" || parsed.action === "wait" ? parsed.action : "send_message";
  const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";
  if (!rationale) throw new Error("Action proposal came back empty");
  return {
    action,
    rationale,
    taskTitle:
      typeof parsed.taskTitle === "string" && parsed.taskTitle.trim()
        ? parsed.taskTitle.trim()
        : `Re-engage ${deal.companyName || deal.name}`,
    message:
      action === "send_message" && typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message.trim()
        : null,
  };
}
