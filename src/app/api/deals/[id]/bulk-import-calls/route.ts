import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { importSelectedCalls } from "@/lib/deals/bulk-import-calls";

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
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

  const body = await request.json().catch(() => ({}));
  const callIds = Array.isArray(body.callIds)
    ? body.callIds.filter((c: unknown): c is string => typeof c === "string")
    : [];
  if (callIds.length === 0) {
    return NextResponse.json({ error: "No callIds provided" }, { status: 400 });
  }

  try {
    const result = await importSelectedCalls(user.id, id, callIds);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[bulk-import-calls] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
