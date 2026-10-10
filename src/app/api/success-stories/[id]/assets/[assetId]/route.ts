import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * DELETE /api/success-stories/[id]/assets/[assetId] — remove one
 * generated asset from the collection's library.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id, assetId } = await params;
    const collection = await prisma.successStoryCollection.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!collection) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.successAsset.deleteMany({ where: { id: assetId, collectionId: id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[success-stories] asset DELETE failed:", err);
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 });
  }
}
