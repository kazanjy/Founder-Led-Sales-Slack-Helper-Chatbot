import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { serializePracticeSession } from "@/lib/practice/serialize";

/**
 * GET    /api/practice/sessions/[id] — one session (hidden stripped
 *        until completed).
 * DELETE — abandon/remove a session (history hygiene).
 */

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
    const session = await prisma.practiceSession.findFirst({
      where: { id, userId: user.id },
    });
    if (!session) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ session: serializePracticeSession(session) });
  } catch (err) {
    console.error("[practice session] GET failed:", err);
    return NextResponse.json({ error: "Failed to load session" }, { status: 500 });
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
    const session = await prisma.practiceSession.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!session) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.practiceSession.delete({ where: { id: session.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[practice session] DELETE failed:", err);
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
