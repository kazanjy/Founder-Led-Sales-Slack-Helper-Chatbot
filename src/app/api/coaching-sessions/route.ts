import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateSessionTitle } from "@/lib/openai";

// GET - List all coaching sessions visible to the current user (account-wide)
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // If user belongs to an account, show all sessions from account members
    let whereClause: { userId: string } | { user: { accountId: string } };
    if (user.accountId) {
      whereClause = { user: { accountId: user.accountId } };
    } else {
      whereClause = { userId: user.id };
    }

    const sessions = await prisma.coachingSession.findMany({
      where: whereClause,
      orderBy: { sessionDate: "desc" },
      select: {
        id: true,
        title: true,
        sessionDate: true,
        notes: true,
        transcript: true,
        recordingUrl: true,
        sessionStatus: true,
        maturityStage: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        user: {
          select: {
            name: true,
            email: true,
            slackUserName: true,
          },
        },
      },
    });

    return NextResponse.json({ sessions, currentUserId: user.id });
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
    const { title, sessionDate, notes, transcript, recordingUrl } = body;

    if (!sessionDate) {
      return NextResponse.json(
        { error: "Date is required." },
        { status: 400 }
      );
    }

    // Auto-generate title from session content if not provided (skip for drafts)
    const notesText = notes?.trim() || "";
    const isDraft = notesText === "(draft)" || notesText === "";
    const sessionTitle = title?.trim()
      ? title.trim()
      : isDraft
        ? ""
        : await generateSessionTitle(notesText, transcript?.trim());

    // ── Carry-forward logic ──────────────────────────────────────────

    // 1. Lock any previous NEW or IN_PROGRESS session
    await prisma.coachingSession.updateMany({
      where: {
        userId: user.id,
        sessionStatus: { in: ["new", "in_progress"] },
      },
      data: { sessionStatus: "locked" },
    });

    // 2. Snapshot current maturity stage
    const maturityStage = await prisma.salesMaturityStage.findUnique({
      where: { userId: user.id },
    });

    // 3. Create the new session
    const session = await prisma.coachingSession.create({
      data: {
        userId: user.id,
        title: sessionTitle,
        sessionDate: new Date(sessionDate),
        notes: notesText,
        transcript: transcript?.trim() || null,
        recordingUrl: recordingUrl?.trim() || null,
        sessionStatus: "new",
        maturityStage: maturityStage?.currentStage || null,
      },
    });

    // 4. Create default metric definitions if this is the user's first session
    const existingMetrics = await prisma.coachingMetricDefinition.count({
      where: { userId: user.id },
    });

    if (existingMetrics === 0) {
      await prisma.coachingMetricDefinition.createMany({
        data: [
          { userId: user.id, name: "Customer Count", definition: "Number of paying customers (signed contract, active subscription, etc.)", format: "number", isDefault: true, order: 0 },
          { userId: user.id, name: "ARR", definition: "Annual Recurring Revenue — total annualized value of recurring contracts", format: "currency", isDefault: true, order: 1 },
        ],
      });
    }

    // 5. Create empty metric entries for all active (non-archived) metric definitions
    const allMetrics = await prisma.coachingMetricDefinition.findMany({
      where: { userId: user.id, archived: false },
      orderBy: { order: "asc" },
    });

    if (allMetrics.length > 0) {
      // Check which metrics already have entries for this session (avoid dupes)
      const existingEntries = await prisma.coachingMetricEntry.findMany({
        where: { sessionId: session.id },
        select: { metricDefinitionId: true },
      });
      const existingDefIds = new Set(existingEntries.map((e) => e.metricDefinitionId));
      const newMetrics = allMetrics.filter((m) => !existingDefIds.has(m.id));

      if (newMetrics.length > 0) {
        await prisma.coachingMetricEntry.createMany({
          data: newMetrics.map((m) => ({
            userId: user.id,
            metricDefinitionId: m.id,
            sessionId: session.id,
            currentValue: 0,
            addedSinceLastSession: 0,
          })),
        });
      }
    }

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error("[Coaching Sessions] Create error:", error);
    return NextResponse.json({ error: "Failed to create coaching session" }, { status: 500 });
  }
}
