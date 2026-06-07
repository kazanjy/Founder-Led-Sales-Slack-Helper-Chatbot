import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { attributeEntryToParticipants } from "@/lib/deals/attribute";
import { classifyEntryContent } from "@/lib/deals/classify-entry";

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
    const shouldClassify = !trimmedTitle && trimmedContent.length >= MIN_CONTENT_FOR_CLASSIFY;

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
    let finalType = type;
    let finalTitle: string | null = trimmedTitle || null;
    let finalEntryDate: Date = entryDate ? new Date(entryDate) : new Date();
    if (classifyResult) {
      if (!finalTitle && classifyResult.title) finalTitle = classifyResult.title;
      if (!entryDate && classifyResult.date) finalEntryDate = new Date(classifyResult.date);
      if (type === "note" && classifyResult.suggestedType && classifyResult.suggestedType !== "note") {
        finalType = classifyResult.suggestedType;
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

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Error adding timeline entry:", error);
    return NextResponse.json({ error: "Failed to add entry" }, { status: 500 });
  }
}
