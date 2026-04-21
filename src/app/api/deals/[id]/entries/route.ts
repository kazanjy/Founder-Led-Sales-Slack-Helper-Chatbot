import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

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
    const { type, title, content, sourceUrl, metadata, entryDate } = body;

    if (!type || !content?.trim()) {
      return NextResponse.json({ error: "type and content are required" }, { status: 400 });
    }

    const entry = await prisma.dealTimelineEntry.create({
      data: {
        dealId: id,
        type,
        title: title?.trim() || null,
        content: content.trim(),
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
