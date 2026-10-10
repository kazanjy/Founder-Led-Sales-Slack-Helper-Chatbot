import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findBulkImportCandidates } from "@/lib/deals/bulk-import-calls";

export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;

  // Ownership / account-scope check
  const deal = await prisma.deal.findFirst({
    where: user.accountId
      ? { id, user: { accountId: user.accountId } }
      : { id, userId: user.id },
    select: { id: true },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  try {
    const result = await findBulkImportCandidates(user.id, id);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[bulk-import-calls/candidates] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to scan calls" },
      { status: 500 }
    );
  }
}
