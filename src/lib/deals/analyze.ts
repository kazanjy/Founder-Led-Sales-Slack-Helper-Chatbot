import { prisma } from "@/lib/db";
import { openai } from "@/lib/openai";

/**
 * Deal analysis pipeline shared by the on-demand POST handler at
 * /api/deals/[id]/analyze and the daily cron at
 * /api/cron/refresh-deal-health. Builds the prompt context from the
 * deal's timeline + participants + sales narrative, asks gpt-5.5
 * for a structured analysis, parses three machine-parseable footers
 * (PARTICIPANT_ROLES, SUGGESTED_STAGE, MIKEY_HEALTH), applies them
 * to the deal row, and logs a stage_change timeline entry when the
 * analyzer auto-flips the stage.
 */

const VALID_STAGES = [
  "prospecting",
  "discovery",
  "demo",
  "proposal",
  "negotiation",
  "closing",
  "won",
  "lost",
] as const;
type DealStage = (typeof VALID_STAGES)[number];

const VALID_ROLES = new Set([
  "champion",
  "decision_maker",
  "influencer",
  "blocker",
  "end_user",
  "unknown",
]);

const VALID_HEALTH = new Set(["poor", "fair", "good", "excellent"]);

function extractMikeyHealth(text: string): { health: string | null; cleaned: string } {
  const match = text.match(/^\s*MIKEY_HEALTH:\s*([a-z]+)\s*$/im);
  if (!match) return { health: null, cleaned: text };
  const candidate = match[1].trim().toLowerCase();
  const health = VALID_HEALTH.has(candidate) ? candidate : null;
  const cleaned = text.replace(match[0], "").replace(/\n{3,}$/, "\n\n").trimEnd();
  return { health, cleaned };
}

function extractSuggestedStage(text: string): { stage: DealStage | null; cleaned: string } {
  const match = text.match(/^\s*SUGGESTED_STAGE:\s*([a-z_]+)\s*$/im);
  if (!match) return { stage: null, cleaned: text };
  const candidate = match[1].trim().toLowerCase();
  const stage = (VALID_STAGES as readonly string[]).includes(candidate) ? (candidate as DealStage) : null;
  const cleaned = text.replace(match[0], "").replace(/\n{3,}$/, "\n\n").trimEnd();
  return { stage, cleaned };
}

function extractParticipantRoles(text: string): {
  roles: Map<string, string>;
  cleaned: string;
} {
  const roles = new Map<string, string>();
  const blockMatch = text.match(/PARTICIPANT_ROLES_START\s*([\s\S]*?)\s*PARTICIPANT_ROLES_END/i);
  if (!blockMatch) return { roles, cleaned: text };
  const body = blockMatch[1];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim().replace(/^[-*]\s*/, "");
    if (!line) continue;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*[:|]\s*([a-z_]+)\s*$/);
    if (!m) continue;
    const [, id, role] = m;
    const normalized = role.toLowerCase();
    if (!VALID_ROLES.has(normalized) || normalized === "unknown") continue;
    roles.set(id, normalized);
  }
  const cleaned = text.replace(blockMatch[0], "").replace(/\n{3,}$/, "\n\n").trimEnd();
  return { roles, cleaned };
}

export interface DealAnalysisResult {
  analysis: string;
  stage: string;
  stageUpdated: boolean;
  rolesUpdated: number;
  mikeyHealth: string | null;
  lastAnalyzedAt: Date;
  historyId: string;
}

export class DealNotFoundError extends Error {
  constructor() {
    super("Deal not found");
    this.name = "DealNotFoundError";
  }
}

export async function runDealAnalysis(userId: string, dealId: string): Promise<DealAnalysisResult> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      participants: { orderBy: { createdAt: "asc" } },
      entries: { orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }] },
    },
  });
  if (!deal || deal.userId !== userId) {
    throw new DealNotFoundError();
  }

  const sections: string[] = [];

  sections.push(`# Deal: ${deal.name}`);
  sections.push(`Company: ${deal.companyName}`);
  sections.push(`Stage: ${deal.stage} | Status: ${deal.status}`);
  if (deal.notes) sections.push(`Notes: ${deal.notes}`);
  sections.push("");

  if (deal.participants.length > 0) {
    sections.push("## Participants");
    for (const p of deal.participants) {
      const parts = [`- [id:${p.id}] **${p.name}**`];
      if (p.title) parts.push(`(${p.title})`);
      if (p.company) parts.push(`@ ${p.company}`);
      if (p.role && p.role !== "unknown") parts.push(`— Role: ${p.role}`);
      if (p.email) parts.push(`— ${p.email}`);
      sections.push(parts.join(" "));
    }
    sections.push("");
  }

  const now = Date.now();
  const analyzableEntries = deal.entries.filter((e) => e.type !== "chat");
  const upcomingMeetings = analyzableEntries.filter(
    (e) => e.type === "meeting" && new Date(e.entryDate).getTime() > now
  );
  const stageChanges = analyzableEntries.filter((e) => e.type === "stage_change");
  const pastEntries = analyzableEntries.filter(
    (e) => !upcomingMeetings.includes(e) && e.type !== "stage_change"
  );

  if (stageChanges.length > 0) {
    sections.push("## Stage History");
    const sorted = [...stageChanges].sort(
      (a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime()
    );
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];
      const dateMs = new Date(entry.entryDate).getTime();
      const date = new Date(entry.entryDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const nextMs = i < sorted.length - 1 ? new Date(sorted[i + 1].entryDate).getTime() : now;
      const days = Math.max(0, Math.round((nextMs - dateMs) / 86400000));
      const tail = i < sorted.length - 1
        ? ` — held for ${days} day${days === 1 ? "" : "s"}`
        : ` — current stage, in for ${days} day${days === 1 ? "" : "s"}`;
      sections.push(`- ${date}: ${entry.title || "Stage change"}${tail}`);
    }
    sections.push("");
  }

  if (upcomingMeetings.length > 0) {
    sections.push("## Upcoming Meetings (next 90 days)");
    const sortedUpcoming = [...upcomingMeetings].sort(
      (a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime()
    );
    for (const entry of sortedUpcoming) {
      const date = new Date(entry.entryDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
      sections.push(`### ${date}${entry.title ? `: ${entry.title}` : ""}`);
      // Upcoming meeting bodies are agenda / invite descriptions
      // pulled by enrichCalendar — frequently 1–2k chars when they
      // include doc links + meeting goals. Bump the analyzer cap from
      // 800 → 6000 so the model actually has the agenda to reason
      // about ("Mikey, what should I prep for this discovery call?").
      const content = entry.content.length > 6000 ? entry.content.substring(0, 6000) + "…" : entry.content;
      sections.push(content);
      sections.push("");
    }
  }

  if (pastEntries.length > 0) {
    sections.push("## Timeline (past)");
    for (const entry of pastEntries) {
      const date = new Date(entry.entryDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      sections.push(`### ${date} — ${entry.type}${entry.title ? `: ${entry.title}` : ""}`);
      const content = entry.content.length > 3000
        ? entry.content.substring(0, 3000) + "\n\n[...truncated]"
        : entry.content;
      sections.push(content);
      sections.push("");
    }
  }

  let narrativeContext = "";
  try {
    const narrativeVersion = await prisma.salesNarrativeVersion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { narrative: true },
    });
    if (narrativeVersion?.narrative) {
      narrativeContext = `\n## Seller's Sales Narrative (for context)\n${narrativeVersion.narrative.substring(0, 2000)}\n`;
    }
  } catch { /* ignore */ }

  const dealContext = sections.join("\n") + narrativeContext;

  const isReanalysis = Boolean(deal.lastAnalysis?.trim());

  const priorAnalysisBlock = isReanalysis
    ? `\n## Previous Analysis (${deal.lastAnalyzedAt ? new Date(deal.lastAnalyzedAt).toISOString() : "earlier"})\n${deal.lastAnalysis!.substring(0, 3000)}\n`
    : "";

  const newEntryCount = isReanalysis && deal.lastAnalyzedAt
    ? analyzableEntries.filter((e) => new Date(e.createdAt) > deal.lastAnalyzedAt!).length
    : 0;

  const sectionRequirements = isReanalysis
    ? `## What's Changed
A tight bullet list of what's new or shifted since the previous analysis. Focus on: ${newEntryCount > 0 ? `the ${newEntryCount} new timeline ${newEntryCount === 1 ? "entry" : "entries"} added, ` : ""}new participants, stage movement, new risks or positive signals, and anything from the prior analysis that is now resolved or obsolete. If nothing meaningful has changed, say so in one line.

## What's Next
3-5 specific, prioritized next steps the founder should take in the next 1-2 weeks. Be concrete — name specific people, topics, and timeframes. This replaces the old "Recommended Next Steps" section; do not repeat it later.

## Deal Summary
A 2-3 sentence overview of where this deal stands now.

## Strengths
What's going well — champion engagement, urgency signals, technical fit, etc.

## Risks & Gaps
What could derail this deal — missing stakeholders, stalled momentum, unaddressed objections, competitive threats.

## Stakeholder Map
For each participant, assess their likely role (champion, decision maker, blocker, influencer) and engagement level based on the evidence.

## Suggested Stage
Based on the evidence, recommend what pipeline stage this deal should be in and explain why.

## Mikey Health
A single-line overall verdict: Excellent / Good / Fair / Poor + one sentence justifying it. This must match the MIKEY_HEALTH footer below and reflect the same evidence cited in Strengths and Risks & Gaps.`
    : `## Deal Summary
A 2-3 sentence overview of where this deal stands.

## Strengths
What's going well — champion engagement, urgency signals, technical fit, etc.

## Risks & Gaps
What could derail this deal — missing stakeholders, stalled momentum, unaddressed objections, competitive threats, etc.

## Stakeholder Map
For each participant, assess their likely role (champion, decision maker, blocker, influencer) and engagement level based on the evidence.

## Recommended Next Steps
3-5 specific, actionable next steps ranked by priority. Be concrete — name specific people, topics, and timelines.

## Suggested Stage
Based on the evidence, recommend what pipeline stage this deal should be in and explain why.

## Mikey Health
A single-line overall verdict: Excellent / Good / Fair / Poor + one sentence justifying it. This must match the MIKEY_HEALTH footer below and reflect the same evidence cited in Strengths and Risks & Gaps.`;

  const systemPrompt = `You are an expert B2B sales strategist analyzing a founder's active deal. Given the deal's timeline (calls, emails, notes), participants, ${upcomingMeetings.length > 0 ? "upcoming meetings scheduled in the next 90 days, " : ""}${stageChanges.length > 0 ? "stage history with time-in-stage durations, " : ""}and optionally the seller's sales narrative${isReanalysis ? ", plus the previous analysis for comparison" : ""}, provide a comprehensive analysis.
${isReanalysis ? `\nThis is a RE-ANALYSIS — the founder has added new context since the last run. Lead with what's changed and what they should do next, then follow with the full assessment.\n` : ""}${upcomingMeetings.length > 0 ? `\nThe deal has ${upcomingMeetings.length} upcoming meeting${upcomingMeetings.length === 1 ? "" : "s"} on the calendar. Treat them as committed pipeline — your "What's Next" / "Recommended Next Steps" should explicitly tee up what to prepare for, ask in, or follow up after those meetings. Flag in "Risks & Gaps" if the calendar is empty when it shouldn't be (e.g. a deal in proposal stage with no next meeting scheduled is a momentum risk).\n` : `\nThe deal has NO upcoming meetings on the calendar. Call this out as a momentum signal in "Risks & Gaps" if the deal is past the prospecting stage — a live deal with no scheduled next meeting is usually a problem.\n`}${stageChanges.length > 0 ? `\nThe Stage History section shows each pipeline transition with how long the deal sat in each stage. Use these durations to assess velocity in "Risks & Gaps" — long dwells in a single stage (especially Discovery, Proposal, or Negotiation) are a stall signal; quick transitions can be a positive momentum signal.\n` : ""}
Your analysis MUST include these sections, in this exact order:

${sectionRequirements}

Be direct and specific. Reference actual conversations and participants by name. Don't hedge or use generic advice.

After the markdown analysis above, output a machine-parseable footer in this EXACT format (no other text after it):

PARTICIPANT_ROLES_START
<participantId>: <role>
<participantId>: <role>
PARTICIPANT_ROLES_END
SUGGESTED_STAGE: <stage>
MIKEY_HEALTH: <health>

Rules for PARTICIPANT_ROLES:
- Use the [id:...] value from the Participants section above as <participantId>.
- <role> must be exactly one of: champion, decision_maker, influencer, blocker, end_user.
- Only emit a line for a participant if the evidence in the timeline genuinely supports the role. Skip participants you can't confidently classify (don't emit "unknown").
- If the participant works for the SELLER (the founder's own company), skip them entirely.

<stage> must be exactly one of: prospecting, discovery, demo, proposal, negotiation, closing, won, lost.

Rules for MIKEY_HEALTH (holistic deal health, single-word verdict — must be one of: excellent, good, fair, poor):
- excellent: champion identified + decision maker engaged + upcoming meeting on the calendar + strong recent activity + no major risks. The deal is moving and you'd bet on it closing.
- good: solid stakeholder coverage, healthy engagement, momentum is positive, minor risks but nothing alarming. You're not worried.
- fair: at least one meaningful risk (stalled momentum, missing decision-maker, long dwell in current stage, no upcoming meeting on an active deal). Recoverable but needs attention this week.
- poor: multiple risks compounding (champion silent, no upcoming meeting AND long dwell, lost competitor signal, key stakeholder churned, etc.). This deal is in trouble.
- Anchor the rating in the SAME evidence you cited in Strengths and Risks & Gaps — don't grade easier than the prose suggests.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.5",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: (dealContext + priorAnalysisBlock).substring(0, 30000) },
    ],
    max_completion_tokens: 2000,
  });

  const rawAnalysis = response.choices[0]?.message?.content?.trim() || "Analysis could not be generated.";
  const { roles: suggestedRoles, cleaned: afterRoles } = extractParticipantRoles(rawAnalysis);
  const { health: suggestedHealth, cleaned: afterHealth } = extractMikeyHealth(afterRoles);
  const { stage: suggestedStage, cleaned: analysis } = extractSuggestedStage(afterHealth);

  const shouldUpdateStage =
    suggestedStage !== null &&
    suggestedStage !== deal.stage &&
    deal.status !== "closed_won" &&
    deal.status !== "closed_lost";

  const dealParticipantIds = new Set(deal.participants.map((p) => p.id));
  const unknownById = new Map(
    deal.participants.filter((p) => p.role === "unknown").map((p) => [p.id, p])
  );
  const roleUpdates: Array<{ id: string; role: string }> = [];
  for (const [pid, role] of suggestedRoles) {
    if (!dealParticipantIds.has(pid)) continue;
    if (!unknownById.has(pid)) continue;
    roleUpdates.push({ id: pid, role });
  }

  const [updated, history] = await prisma.$transaction([
    prisma.deal.update({
      where: { id: dealId },
      data: {
        lastAnalysis: analysis,
        lastAnalyzedAt: new Date(),
        ...(shouldUpdateStage ? { stage: suggestedStage } : {}),
        ...(suggestedHealth ? { mikeyHealth: suggestedHealth } : {}),
      },
      select: { stage: true, lastAnalyzedAt: true },
    }),
    prisma.dealAnalysis.create({
      data: {
        dealId,
        analysis,
        stage: suggestedStage,
        entryCount: deal.entries.length,
        participantCount: deal.participants.length,
      },
      select: { id: true, createdAt: true },
    }),
    ...roleUpdates.map((u) =>
      prisma.dealParticipant.update({
        where: { id: u.id },
        data: { role: u.role },
      })
    ),
    ...(shouldUpdateStage && suggestedStage
      ? [
          prisma.dealTimelineEntry.create({
            data: {
              dealId,
              type: "stage_change",
              title: `Stage: ${deal.stage} → ${suggestedStage}`,
              content: `Pipeline stage changed from **${deal.stage}** to **${suggestedStage}** by Deal Analyzer.`,
              entryDate: new Date(),
              metadata: JSON.stringify({
                auto_logged: true,
                source: "analyzer",
                fromStage: deal.stage,
                toStage: suggestedStage,
              }),
            },
          }),
        ]
      : []),
  ]);

  return {
    analysis,
    stage: updated.stage,
    stageUpdated: shouldUpdateStage,
    rolesUpdated: roleUpdates.length,
    mikeyHealth: suggestedHealth || null,
    lastAnalyzedAt: updated.lastAnalyzedAt!,
    historyId: history.id,
  };
}
