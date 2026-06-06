import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { attributeEntryToParticipants } from "@/lib/deals/attribute";

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

    // Run participant attribution if the entry type is conversation-shaped,
    // the content is meaty enough to be worth a GPT call, there are
    // participants to match against, AND the client didn't already supply
    // linked IDs (screenshots pass them from the vision pass).
    const alreadyAttributed = Array.isArray(metadata?.linkedParticipantIds) && (metadata!.linkedParticipantIds as unknown[]).length > 0;
    if (
      !alreadyAttributed &&
      ATTRIBUTABLE_TYPES.has(type) &&
      trimmedContent.length >= MIN_CONTENT_FOR_ATTRIBUTION
    ) {
      const participants = await prisma.dealParticipant.findMany({
        where: { dealId: id },
        select: { id: true, name: true, title: true, email: true, company: true },
      });
      if (participants.length > 0) {
        const ownerLabel = `${user.name || user.email || "Deal Owner"}${user.email ? ` <${user.email}>` : ""}`;
        const { matchedParticipantIds } = await attributeEntryToParticipants(
          trimmedContent,
          participants,
          ownerLabel,
        );
        if (matchedParticipantIds.length > 0) {
          metadata = { ...(metadata ?? {}), linkedParticipantIds: matchedParticipantIds };
        }
      }
    }

    const entry = await prisma.dealTimelineEntry.create({
      data: {
        dealId: id,
        type,
        title: title?.trim() || null,
        content: trimmedContent,
        sourceUrl: sourceUrl?.trim() || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        entryDate: entryDate ? new Date(entryDate) : new Date(),
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
