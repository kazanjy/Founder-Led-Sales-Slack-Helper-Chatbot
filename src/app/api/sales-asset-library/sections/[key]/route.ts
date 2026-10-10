import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// PATCH — archive/unarchive all assets in a section
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { key } = await params;
    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.archived !== undefined) updateData.archived = !!body.archived;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const result = await prisma.salesAsset.updateMany({
      where: { accountId: user.accountId, category: key },
      data: updateData,
    });

    return NextResponse.json({ success: true, count: result.count });
  } catch (error) {
    console.error("Error updating section:", error);
    return NextResponse.json({ error: "Failed to update section" }, { status: 500 });
  }
}

// DELETE — delete all custom assets in a section (default assets are preserved)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { key } = await params;

    // Only delete custom (non-default) assets. Default assets would re-seed anyway.
    const result = await prisma.salesAsset.deleteMany({
      where: {
        accountId: user.accountId,
        category: key,
        isDefault: false,
      },
    });

    return NextResponse.json({ success: true, count: result.count });
  } catch (error) {
    console.error("Error deleting section:", error);
    return NextResponse.json({ error: "Failed to delete section" }, { status: 500 });
  }
}
