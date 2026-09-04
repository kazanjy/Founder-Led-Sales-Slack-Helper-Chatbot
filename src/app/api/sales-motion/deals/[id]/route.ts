import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

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
    const body = await request.json();
    const { name, outcome, dealOrder } = body;

    // Verify the deal's collection belongs to the user
    const deal = await prisma.salesMotionDeal.findUnique({
      where: { id },
      include: { collection: { select: { userId: true } } },
    });

    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    if (deal.collection.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const updateData: { name?: string; outcome?: string; dealOrder?: number } = {};
    if (name !== undefined) updateData.name = name;
    if (outcome !== undefined) updateData.outcome = outcome;
    if (dealOrder !== undefined) updateData.dealOrder = dealOrder;

    const updated = await prisma.salesMotionDeal.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ success: true, deal: updated });
  } catch (error) {
    console.error("Error updating sales motion deal:", error);
    return NextResponse.json(
      { error: "Failed to update deal" },
      { status: 500 }
    );
  }
}

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

    const deal = await prisma.salesMotionDeal.findUnique({
      where: { id },
      include: { collection: { select: { userId: true } } },
    });

    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    if (deal.collection.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    await prisma.salesMotionDeal.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting sales motion deal:", error);
    return NextResponse.json(
      { error: "Failed to delete deal" },
      { status: 500 }
    );
  }
}
