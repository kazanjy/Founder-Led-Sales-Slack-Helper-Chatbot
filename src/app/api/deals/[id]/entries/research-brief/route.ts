import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { attachResearchBriefToDeal } from "@/lib/deals/attach-research-brief";

/**
 * POST /api/deals/[id]/entries/research-brief
 *
 * Upsert a Pre-Call Plan timeline entry on a deal. Used by:
 *  - The deal-page "🔬 Pre-Call Plan" affordance (deal user → research
 *    page handoff → after-save attach)
 *  - The daily-research-briefs cron when an upcoming-meeting brief
 *    matches an open deal's domain
 *
 * Dedupes by metadata.researchId so re-saves (manual or cron) update
 * the existing row instead of stacking. The entry stores a short
 * preview in content + a deep link in sourceUrl, so the timeline
 * renders a clickable summary.
 *
 * Body:
 *   {
 *     researchId: string,   // PreCallResearch row id (REQUIRED)
 *     title: string,        // e.g. "Pre-Call Plan: Acme — Discovery"
 *     preview: string,      // first ~400 chars of the brief
 *     sourceUrl: string,    // typically /pre-call-planning/research?id=<id>
 *     entryDate?: string,   // ISO; defaults to the meeting date or now
 *     calendarEventId?: string,
 *     attendeeEmails?: string[],
 *   }
 */
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
    const deal = await prisma.deal.findFirst({
      where: user.accountId
        ? { id, user: { accountId: user.accountId } }
        : { id, userId: user.id },
      select: { id: true },
    });
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const researchId = typeof body.researchId === "string" ? body.researchId : null;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const preview = typeof body.preview === "string" ? body.preview.trim() : "";
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
    const entryDate = typeof body.entryDate === "string" ? new Date(body.entryDate) : new Date();
    const calendarEventId = typeof body.calendarEventId === "string" ? body.calendarEventId : null;
    const attendeeEmails = Array.isArray(body.attendeeEmails)
      ? body.attendeeEmails.filter((e: unknown): e is string => typeof e === "string")
      : [];

    if (!researchId || !title || !preview || !sourceUrl) {
      return NextResponse.json(
        { error: "researchId, title, preview, and sourceUrl are required" },
        { status: 400 }
      );
    }

    const result = await attachResearchBriefToDeal({
      dealId: id,
      researchId,
      title,
      preview,
      sourceUrl,
      entryDate,
      calendarEventId,
      attendeeEmails,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[entries/research-brief] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to attach research brief" },
      { status: 500 }
    );
  }
}
