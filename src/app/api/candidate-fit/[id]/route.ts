import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/** One stored assessment, with its full report and raw profile. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;

    const assessment = await prisma.candidateAssessment.findFirst({
      where: {
        id,
        ...(user.accountId ? { user: { accountId: user.accountId } } : { userId: user.id }),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!assessment) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ assessment });
  } catch (error) {
    console.error("[candidate-fit] fetch failed:", error);
    return NextResponse.json({ error: "Failed to load assessment" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;

    // Deletion stays with the author — a stored assessment is an
    // account-visible record, not an account-editable one.
    const deleted = await prisma.candidateAssessment.deleteMany({
      where: { id, userId: user.id },
    });
    if (deleted.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candidate-fit] delete failed:", error);
    return NextResponse.json({ error: "Failed to delete assessment" }, { status: 500 });
  }
}
