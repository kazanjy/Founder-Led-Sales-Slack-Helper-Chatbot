import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

async function verifyEntry(dealId: string, entryId: string, userId: string) {
  const entry = await prisma.dealTimelineEntry.findUnique({
    where: { id: entryId },
    include: { deal: true },
  });
  if (!entry || entry.dealId !== dealId || entry.deal.userId !== userId) return null;
  return entry;
}

// PATCH — update a timeline entry
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id, entryId } = await params;
    const entry = await verifyEntry(id, entryId, user.id);
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.title !== undefined) updateData.title = body.title?.trim() || null;
    if (body.content !== undefined) updateData.content = body.content.trim();
    if (body.sourceUrl !== undefined) updateData.sourceUrl = body.sourceUrl?.trim() || null;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.entryDate !== undefined) updateData.entryDate = new Date(body.entryDate);
    if (body.metadata !== undefined) updateData.metadata = body.metadata ? JSON.stringify(body.metadata) : null;

    const updated = await prisma.dealTimelineEntry.update({
      where: { id: entryId },
      data: updateData,
    });

    return NextResponse.json({ entry: updated });
  } catch (error) {
    console.error("Error updating entry:", error);
    return NextResponse.json({ error: "Failed to update entry" }, { status: 500 });
  }
}

// DELETE — remove a timeline entry
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id, entryId } = await params;
    const entry = await verifyEntry(id, entryId, user.id);
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    await prisma.dealTimelineEntry.delete({ where: { id: entryId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting entry:", error);
    return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 });
  }
}
