import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { searchScope } from "@/lib/sourcing/searches";

const STATUSES = ["new", "shortlisted", "passed"] as const;

/**
 * Triage state for a lead.
 *
 * Kept on the lead rather than derived, because "I already looked at
 * this person and passed" is the single most valuable thing a saved
 * search remembers: without it, coming back a week later means
 * re-reading the same rejects.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; leadId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { id, leadId } = await params;

    // Authorize through the parent search, so a lead id alone is never
    // enough to reach another account's data.
    const search = await prisma.sourcingSearch.findFirst({
      where: { id, ...searchScope(user) },
      select: { id: true },
    });
    if (!search) return NextResponse.json({ error: "Search not found" }, { status: 404 });

    const body = await request.json();
    const status = body.status;
    if (!STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of ${STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const updated = await prisma.sourcingLead.updateMany({
      where: { id: leadId, searchId: id },
      data: { status },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, status });
  } catch (error) {
    console.error("[sourcing/searches/:id/leads/:leadId] PATCH", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
