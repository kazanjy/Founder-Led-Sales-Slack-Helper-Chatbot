import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - List all coaching sessions for the current user
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const sessions = await prisma.coachingSession.findMany({
      where: { userId: user.id },
      orderBy: { sessionDate: "desc" },
      select: {
        id: true,
        title: true,
        sessionDate: true,
        notes: true,
        transcript: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("[Coaching Sessions] List error:", error);
    return NextResponse.json({ error: "Failed to fetch coaching sessions" }, { status: 500 });
  }
}

// POST - Create a new coaching session
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { title, sessionDate, notes, transcript } = body;

    if (!title?.trim() || !sessionDate || !notes?.trim()) {
      return NextResponse.json(
        { error: "Title, date, and notes are required." },
        { status: 400 }
      );
    }

    const session = await prisma.coachingSession.create({
      data: {
        userId: user.id,
        title: title.trim(),
        sessionDate: new Date(sessionDate),
        notes: notes.trim(),
        transcript: transcript?.trim() || null,
      },
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error("[Coaching Sessions] Create error:", error);
    return NextResponse.json({ error: "Failed to create coaching session" }, { status: 500 });
  }
}
