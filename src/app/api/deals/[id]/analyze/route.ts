import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

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

// Pulls "SUGGESTED_STAGE: <stage>" out of the analysis text. Returns the
// matched stage (if recognized) and the analysis with the marker line removed.
function extractSuggestedStage(text: string): { stage: DealStage | null; cleaned: string } {
  const match = text.match(/^\s*SUGGESTED_STAGE:\s*([a-z_]+)\s*$/im);
  if (!match) return { stage: null, cleaned: text };
  const candidate = match[1].trim().toLowerCase();
  const stage = (VALID_STAGES as readonly string[]).includes(candidate) ? (candidate as DealStage) : null;
  const cleaned = text.replace(match[0], "").replace(/\n{3,}$/, "\n\n").trimEnd();
  return { stage, cleaned };
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const deal = await prisma.deal.findUnique({
      where: { id },
      include: {
        participants: { orderBy: { createdAt: "asc" } },
        entries: { orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }] },
      },
    });

    if (!deal || deal.userId !== user.id) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Assemble context from the deal
    const sections: string[] = [];

    // Deal metadata
    sections.push(`# Deal: ${deal.name}`);
    sections.push(`Company: ${deal.companyName}`);
    sections.push(`Stage: ${deal.stage} | Status: ${deal.status}`);
    if (deal.notes) sections.push(`Notes: ${deal.notes}`);
    sections.push("");

    // Participants
    if (deal.participants.length > 0) {
      sections.push("## Participants");
      for (const p of deal.participants) {
        const parts = [`- **${p.name}**`];
        if (p.title) parts.push(`(${p.title})`);
        if (p.company) parts.push(`@ ${p.company}`);
        if (p.role && p.role !== "unknown") parts.push(`— Role: ${p.role}`);
        if (p.email) parts.push(`— ${p.email}`);
        sections.push(parts.join(" "));
      }
      sections.push("");
    }

    // Timeline entries (truncate transcript-heavy entries)
    if (deal.entries.length > 0) {
      sections.push("## Timeline");
      for (const entry of deal.entries) {
        const date = new Date(entry.entryDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        sections.push(`### ${date} — ${entry.type}${entry.title ? `: ${entry.title}` : ""}`);
        // Keep summaries full but truncate long transcripts
        const content = entry.content.length > 3000
          ? entry.content.substring(0, 3000) + "\n\n[...truncated]"
          : entry.content;
        sections.push(content);
        sections.push("");
      }
    }

    // Fetch Sales Narrative for additional context (optional)
    let narrativeContext = "";
    try {
      const narrativeVersion = await prisma.salesNarrativeVersion.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: { narrative: true },
      });
      if (narrativeVersion?.narrative) {
        narrativeContext = `\n## Seller's Sales Narrative (for context)\n${narrativeVersion.narrative.substring(0, 2000)}\n`;
      }
    } catch { /* ignore */ }

    const dealContext = sections.join("\n") + narrativeContext;

    // Send to GPT for analysis
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: `You are an expert B2B sales strategist analyzing a founder's active deal. Given the deal's timeline (calls, emails, notes), participants, and optionally the seller's sales narrative, provide a comprehensive analysis.

Your analysis MUST include these sections:

## Deal Summary
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

Be direct and specific. Reference actual conversations and participants by name. Don't hedge or use generic advice.

After the markdown analysis above, output ONE final line in this exact format so it can be machine-parsed:
SUGGESTED_STAGE: <stage>

<stage> must be exactly one of: prospecting, discovery, demo, proposal, negotiation, closing, won, lost.`,
        },
        {
          role: "user",
          content: dealContext.substring(0, 30000),
        },
      ],
      max_completion_tokens: 2000,
      temperature: 0.4,
    });

    const rawAnalysis = response.choices[0]?.message?.content?.trim() || "Analysis could not be generated.";
    const { stage: suggestedStage, cleaned: analysis } = extractSuggestedStage(rawAnalysis);

    // Only overwrite stage if GPT returned a recognized one AND the deal isn't already closed.
    const shouldUpdateStage =
      suggestedStage !== null &&
      suggestedStage !== deal.stage &&
      deal.status !== "closed_won" &&
      deal.status !== "closed_lost";

    const [updated, history] = await prisma.$transaction([
      prisma.deal.update({
        where: { id },
        data: {
          lastAnalysis: analysis,
          lastAnalyzedAt: new Date(),
          ...(shouldUpdateStage ? { stage: suggestedStage } : {}),
        },
        select: { stage: true, lastAnalyzedAt: true },
      }),
      prisma.dealAnalysis.create({
        data: {
          dealId: id,
          analysis,
          stage: suggestedStage,
          entryCount: deal.entries.length,
          participantCount: deal.participants.length,
        },
        select: { id: true, createdAt: true },
      }),
    ]);

    return NextResponse.json({
      analysis,
      stage: updated.stage,
      stageUpdated: shouldUpdateStage,
      lastAnalyzedAt: updated.lastAnalyzedAt,
      historyId: history.id,
    });
  } catch (error) {
    console.error("Error analyzing deal:", error);
    return NextResponse.json({ error: "Failed to analyze deal" }, { status: 500 });
  }
}
