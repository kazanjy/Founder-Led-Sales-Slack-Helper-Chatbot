import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Verify the asset belongs to the user's account
async function verifyAccess(id: string, accountId: string) {
  const asset = await prisma.salesAsset.findUnique({ where: { id } });
  if (!asset) return null;
  if (asset.accountId !== accountId) return null;
  return asset;
}

// PATCH — update asset name, description, category, or order
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const asset = await verifyAccess(id, user.accountId);
    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.description !== undefined) updateData.description = body.description?.trim() || null;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.order !== undefined) updateData.order = body.order;
    if (body.archived !== undefined) updateData.archived = !!body.archived;

    const updated = await prisma.salesAsset.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ asset: updated });
  } catch (error) {
    console.error("Error updating sales asset:", error);
    return NextResponse.json({ error: "Failed to update asset" }, { status: 500 });
  }
}

// DELETE — delete a custom asset (default slots cannot be deleted)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const asset = await verifyAccess(id, user.accountId);
    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    if (asset.isDefault) {
      return NextResponse.json({ error: "Default assets cannot be deleted" }, { status: 400 });
    }

    await prisma.salesAsset.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting sales asset:", error);
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 });
  }
}
