import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { attributeEntryToParticipants } from "@/lib/deals/attribute";
import { classifyEntryContent } from "@/lib/deals/classify-entry";
import { runDealAnalysis, DealNotFoundError } from "@/lib/deals/analyze";
import { postAnalysisUpdateStub } from "@/lib/deals/timed-stubs";
import { findDuplicateEntry, isDupeCheckable } from "@/lib/deals/dupe-check";

// The post-add re-analysis runs via after() — keep the function alive
// long enough for it to finish.
export const maxDuration = 300;

// Minimum content length before we pay for the GPT classification pass.
// Tiny notes / quick scribbles aren't worth round-tripping.
const MIN_CONTENT_FOR_CLASSIFY = 200;

// Entry types where auto-attribution is useful enough to pay for a GPT call.
// Notes/documents/screenshots are excluded: notes rarely reference people by
// full name, documents aren't conversational, and screenshots already have
// attribution baked into their extraction pass.
const ATTRIBUTABLE_TYPES = new Set([
  "email",
  "chat",
  "slack_message",
  "sms_message",
  "linkedin",
  "call_transcript",
  "call_summary",
]);
const MIN_CONTENT_FOR_ATTRIBUTION = 150;

// Machine artifacts / system rows that shouldn't trigger a re-analysis
// when created. Everything else a user adds is deal evidence and the
// analysis should reflect it without waiting for a manual Analyze.
const NON_EVIDENCE_TYPES = new Set([
  "chat",
  "stage_change",
  "discovery_summary",
  "roi_model",
  "business_case",
  "recap_email",
  "research_brief",
]);
// Debounce: rapid multi-adds (or a bulk paste session) coalesce into
// the analyses already in flight instead of stacking one per entry.
const REANALYZE_GUARD_MINUTES = 10;

async function verifyDeal(dealId: string, userId: string) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal || deal.userId !== userId) return null;
  return deal;
}

// POST — add a timeline entry to a deal
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const deal = await verifyDeal(id, user.id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const body = await request.json();
    const { type, title, content, sourceUrl, entryDate } = body;
    // Copy metadata so we can enrich it below without mutating the caller.
    let metadata: Record<string, unknown> | undefined = body.metadata && typeof body.metadata === "object" ? { ...body.metadata } : undefined;

    if (!type || !content?.trim()) {
      return NextResponse.json({ error: "type and content are required" }, { status: 400 });
    }

    const trimmedContent = content.trim();
    const trimmedTitle = typeof title === "string" ? title.trim() : "";

    // Auto-classify pass: if the user didn't title the entry (clear "they
    // pasted and clicked Save" signal) and the content is meaty enough,
    // ask GPT to infer title + date + a better type. The user's selected
    // type wins unless they left it on "note" (the catch-all default), in
    // which case we'll upgrade. Runs in parallel with participant
    // attribution below so latency is the max of the two, not the sum.
    // Conversation-shaped types classify even WITH a title — pasted
    // call/email content usually carries its own timestamp ("Date:
    // Monday, July 13, 2026 at 9:59 AM") and we want that time on the
    // entry so it sorts truthfully on the timeline.
    const shouldClassify =
      trimmedContent.length >= MIN_CONTENT_FOR_CLASSIFY &&
      (!trimmedTitle || ATTRIBUTABLE_TYPES.has(type));

    // Duplicate guard: pasted/dropped correspondence that's already on
    // the timeline gets discarded with a NAMED match (409) instead of
    // double-logging. Deterministic shingle containment — see
    // lib/deals/dupe-check.ts. skipDupeCheck lets a client force it
    // through ("add anyway").
    if (body.skipDupeCheck !== true && isDupeCheckable(type, trimmedContent)) {
      try {
        const dupe = await findDuplicateEntry(id, trimmedContent);
        if (dupe) {
          return NextResponse.json(
            {
              error: "duplicate",
              match: {
                entryId: dupe.entryId,
                title: dupe.title,
                entryDate: dupe.entryDate.toISOString(),
                type: dupe.type,
              },
            },
            { status: 409 }
          );
        }
      } catch (err) {
        // A dupe-check failure never blocks a legitimate add.
        console.error(`[entries] dupe check failed for deal ${id}:`, err);
      }
    }

    // Run participant attribution if the entry type is conversation-shaped,
    // the content is meaty enough to be worth a GPT call, there are
    // participants to match against, AND the client didn't already supply
    // linked IDs (screenshots pass them from the vision pass).
    const alreadyAttributed = Array.isArray(metadata?.linkedParticipantIds) && (metadata!.linkedParticipantIds as unknown[]).length > 0;
    const participants = (!alreadyAttributed && ATTRIBUTABLE_TYPES.has(type) && trimmedContent.length >= MIN_CONTENT_FOR_ATTRIBUTION)
      ? await prisma.dealParticipant.findMany({
          where: { dealId: id },
          select: { id: true, name: true, title: true, email: true, company: true },
        })
      : [];
    const ownerLabel = `${user.name || user.email || "Deal Owner"}${user.email ? ` <${user.email}>` : ""}`;

    const [classifyResult, attributionResult] = await Promise.all([
      shouldClassify
        ? classifyEntryContent(trimmedContent, type)
        : Promise.resolve(null),
      participants.length > 0
        ? attributeEntryToParticipants(trimmedContent, participants, ownerLabel)
        : Promise.resolve({ matchedParticipantIds: [] as string[] }),
    ]);

    if (attributionResult.matchedParticipantIds.length > 0) {
      metadata = { ...(metadata ?? {}), linkedParticipantIds: attributionResult.matchedParticipantIds };
    }

    // Bake classifier output into the final fields. Upgrade type only when
    // the user left it on "note" — never override an explicit choice.
    // The classifier's datetime is naive local time (no timezone) —
    // interpret it in the CLIENT's timezone when the client told us its
    // offset, else treat as UTC.
    const tzOffsetMinutes =
      typeof body.tzOffsetMinutes === "number" && Number.isFinite(body.tzOffsetMinutes)
        ? body.tzOffsetMinutes
        : null;
    const dateFromClassifier = (value: string): Date => {
      if (value.length === 10) return new Date(value); // date-only → calendar date (midnight UTC)
      const naiveUtcMs = Date.parse(`${value}:00Z`);
      return tzOffsetMinutes !== null
        ? new Date(naiveUtcMs + tzOffsetMinutes * 60_000)
        : new Date(naiveUtcMs);
    };

    let finalType = type;
    let finalTitle: string | null = trimmedTitle || null;
    let finalEntryDate: Date = entryDate ? new Date(entryDate) : new Date();
    if (classifyResult) {
      if (!finalTitle && classifyResult.title) finalTitle = classifyResult.title;
      if (type === "note" && classifyResult.suggestedType && classifyResult.suggestedType !== "note") {
        finalType = classifyResult.suggestedType;
      }
      if (classifyResult.date) {
        if (!entryDate) {
          // No user-picked date → trust the content's own timestamp.
          finalEntryDate = dateFromClassifier(classifyResult.date);
        } else {
          // User picked a date. If it's date-only (midnight UTC — the
          // picker's output) and the content carries a TIME on the SAME
          // calendar date, upgrade with the time so the entry sorts
          // truthfully among that day's other entries. A different
          // user-picked date always wins — never second-guess it.
          const provided = new Date(entryDate);
          const providedIsDateOnly =
            provided.getUTCHours() === 0 &&
            provided.getUTCMinutes() === 0 &&
            provided.getUTCSeconds() === 0;
          if (
            providedIsDateOnly &&
            classifyResult.date.length > 10 &&
            classifyResult.date.slice(0, 10) === provided.toISOString().slice(0, 10)
          ) {
            finalEntryDate = dateFromClassifier(classifyResult.date);
          }
        }
      }
    }

    const entry = await prisma.dealTimelineEntry.create({
      data: {
        dealId: id,
        type: finalType,
        title: finalTitle,
        content: trimmedContent,
        sourceUrl: sourceUrl?.trim() || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        entryDate: finalEntryDate,
      },
    });

    // Bump deal's updatedAt
    await prisma.deal.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    // New evidence → re-analyze, without waiting for a manual Analyze
    // click or the next cron pass. Debounced so a burst of adds rides
    // the analysis already in flight. Fired via after() so the entry
    // POST returns immediately.
    if (!NON_EVIDENCE_TYPES.has(finalType)) {
      const guardCutoff = new Date(Date.now() - REANALYZE_GUARD_MINUTES * 60 * 1000);
      if (!deal.lastAnalyzedAt || deal.lastAnalyzedAt < guardCutoff) {
        after(async () => {
          try {
            const result = await runDealAnalysis(user.id, id);
            console.log(`[entries] post-add re-analysis completed for deal ${id}`);
            // Same Slack posture as the recorder cron: "🧠 Updated
            // Deal Analysis" stub + full analysis threaded under it.
            // Dismissed deals never get stubs.
            if (deal.status !== "dismissed") {
              await postAnalysisUpdateStub({
                userId: user.id,
                dealId: id,
                companyName: deal.companyName || deal.name,
                healthBefore: deal.mikeyHealth,
                healthAfter: result.mikeyHealth,
                analysis: result.analysis,
              });
            }
          } catch (err) {
            if (err instanceof DealNotFoundError) return;
            console.error(`[entries] post-add re-analysis failed for deal ${id}:`, err);
          }
        });
      }
    }

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Error adding timeline entry:", error);
    return NextResponse.json({ error: "Failed to add entry" }, { status: 500 });
  }
}
