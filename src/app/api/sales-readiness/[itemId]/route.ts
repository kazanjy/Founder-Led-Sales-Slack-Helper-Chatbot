import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// PATCH — update status and/or notes for a readiness item
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!user.accountId) {
      return NextResponse.json({ error: "No account found" }, { status: 400 });
    }

    const { itemId } = await params;
    const body = await request.json();
    const { status, notes } = body;

    // Verify item exists
    const item = await prisma.salesReadinessItem.findUnique({ where: { id: itemId } });
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (status !== undefined) {
      updateData.status = status;
      updateData.statusChangedAt = new Date();
      updateData.statusChangedBy = user.id;
      if (status === "done") {
        updateData.completedAt = new Date();
      } else {
        updateData.completedAt = null;
      }
    }
    if (notes !== undefined) {
      updateData.notes = notes || null;
    }

    // Upsert — create if doesn't exist, update if it does
    const result = await prisma.salesReadinessAccountItem.upsert({
      where: {
        accountId_itemId: {
          accountId: user.accountId,
          itemId,
        },
      },
      update: updateData,
      create: {
        accountId: user.accountId,
        itemId,
        status: status || "to_do",
        statusChangedAt: status ? new Date() : null,
        statusChangedBy: status ? user.id : null,
        completedAt: status === "done" ? new Date() : null,
        notes: notes || null,
      },
    });

    // Get user name for response
    const userName = user.name || user.slackUserName || user.email || "Unknown";

    return NextResponse.json({
      item: {
        id: result.itemId,
        status: result.status,
        statusChangedAt: result.statusChangedAt?.toISOString() || null,
        statusChangedByName: userName,
        completedAt: result.completedAt?.toISOString() || null,
        notes: result.notes,
      },
    });
  } catch (error) {
    console.error("Error updating readiness item:", error);
    return NextResponse.json({ error: "Failed to update item" }, { status: 500 });
  }
}
