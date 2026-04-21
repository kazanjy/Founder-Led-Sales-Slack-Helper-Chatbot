import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

async function verifyAccess(id: string, userId: string) {
  const deal = await prisma.deal.findUnique({ where: { id } });
  if (!deal || deal.userId !== userId) return null;
  return deal;
}

// GET — deal detail with participants + entries
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const exists = await verifyAccess(id, user.id);
    if (!exists) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const deal = await prisma.deal.findUnique({
      where: { id },
      include: {
        participants: { orderBy: { createdAt: "asc" } },
        entries: { orderBy: { entryDate: "desc" } },
        project: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ deal });
  } catch (error) {
    console.error("Error fetching deal:", error);
    return NextResponse.json({ error: "Failed to fetch deal" }, { status: 500 });
  }
}

// PATCH — update deal (name, stage, status, notes, projectId, companyName, companyUrl)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const exists = await verifyAccess(id, user.id);
    if (!exists) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.companyName !== undefined) updateData.companyName = body.companyName.trim();
    if (body.companyUrl !== undefined) updateData.companyUrl = body.companyUrl?.trim() || null;
    if (body.stage !== undefined) updateData.stage = body.stage;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.notes !== undefined) updateData.notes = body.notes?.trim() || null;
    if (body.projectId !== undefined) updateData.projectId = body.projectId || null;

    const deal = await prisma.deal.update({ where: { id }, data: updateData });
    return NextResponse.json({ deal });
  } catch (error) {
    console.error("Error updating deal:", error);
    return NextResponse.json({ error: "Failed to update deal" }, { status: 500 });
  }
}

// DELETE — delete deal (cascades to entries and participants)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const exists = await verifyAccess(id, user.id);
    if (!exists) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    await prisma.deal.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting deal:", error);
    return NextResponse.json({ error: "Failed to delete deal" }, { status: 500 });
  }
}
