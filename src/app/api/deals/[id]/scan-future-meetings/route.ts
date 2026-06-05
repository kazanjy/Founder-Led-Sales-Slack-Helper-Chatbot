import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scanFutureMeetingsForDeal } from "@/lib/deals/scan-future-meetings";

export const maxDuration = 120;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  try {
    const result = await scanFutureMeetingsForDeal(user.id, id);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[scan-future-meetings/deal] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 }
    );
  }
}
