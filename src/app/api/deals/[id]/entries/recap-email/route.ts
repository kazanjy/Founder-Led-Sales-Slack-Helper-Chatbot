import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { attachRecapEmailToDeal } from "@/lib/deals/attach-recap-email";

/**
 * POST /api/deals/[id]/entries/recap-email
 *
 * Upsert a Recap Email timeline entry on a deal. Used by the
 * call-recap page's after-save attach when the recap was kicked off
 * from a deal-page call entry. Dedupes by metadata.recapVersionId so
 * iterating on the draft refreshes the same row.
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
    const recapVersionId = typeof body.recapVersionId === "string" ? body.recapVersionId : null;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const preview = typeof body.preview === "string" ? body.preview.trim() : "";
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
    const entryDate = typeof body.entryDate === "string" ? new Date(body.entryDate) : new Date();
    const sourceEntryId = typeof body.sourceEntryId === "string" ? body.sourceEntryId : null;

    if (!recapVersionId || !title || !preview || !sourceUrl) {
      return NextResponse.json(
        { error: "recapVersionId, title, preview, and sourceUrl are required" },
        { status: 400 }
      );
    }

    const result = await attachRecapEmailToDeal({
      dealId: id,
      recapVersionId,
      title,
      preview,
      sourceUrl,
      entryDate,
      sourceEntryId,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[entries/recap-email] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to attach recap email" },
      { status: 500 }
    );
  }
}
