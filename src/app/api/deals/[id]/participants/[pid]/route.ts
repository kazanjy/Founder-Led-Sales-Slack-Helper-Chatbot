import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

async function verifyParticipant(dealId: string, pid: string, userId: string) {
  const participant = await prisma.dealParticipant.findUnique({
    where: { id: pid },
    include: { deal: true },
  });
  if (!participant || participant.dealId !== dealId || participant.deal.userId !== userId) return null;
  return participant;
}

// PATCH — update a participant
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pid: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id, pid } = await params;
    const participant = await verifyParticipant(id, pid, user.id);
    if (!participant) {
      return NextResponse.json({ error: "Participant not found" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.title !== undefined) updateData.title = body.title?.trim() || null;
    if (body.company !== undefined) updateData.company = body.company?.trim() || null;
    if (body.email !== undefined) updateData.email = body.email?.trim() || null;
    if (body.linkedinUrl !== undefined) updateData.linkedinUrl = body.linkedinUrl?.trim() || null;
    if (body.role !== undefined) updateData.role = body.role;
    if (body.notes !== undefined) updateData.notes = body.notes?.trim() || null;

    const updated = await prisma.dealParticipant.update({ where: { id: pid }, data: updateData });
    return NextResponse.json({ participant: updated });
  } catch (error) {
    console.error("Error updating participant:", error);
    return NextResponse.json({ error: "Failed to update participant" }, { status: 500 });
  }
}

// DELETE — remove a participant
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; pid: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id, pid } = await params;
    const participant = await verifyParticipant(id, pid, user.id);
    if (!participant) {
      return NextResponse.json({ error: "Participant not found" }, { status: 404 });
    }

    await prisma.dealParticipant.delete({ where: { id: pid } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting participant:", error);
    return NextResponse.json({ error: "Failed to delete participant" }, { status: 500 });
  }
}
