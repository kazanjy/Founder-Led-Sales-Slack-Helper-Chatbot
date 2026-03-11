import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get all users with basic info
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        slackEmail: true,
        name: true,
        slackUserName: true,
        avatarUrl: true,
        slackUserId: true,
        workspaceId: true,
        licenseStatus: true,
        createdAt: true,
        lastActiveAt: true,
        updatedAt: true,
        workspace: { select: { slackTeamName: true } },
        conversations: {
          orderBy: { lastMessageAt: "desc" },
          take: 1,
          select: { lastMessageAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const userIds = users.map((u) => u.id);

    // Batch-query existence of each asset type per user using groupBy
    const [
      narrativeUsers,
      discoveryUsers,
      checklistUsers,
      preCallPlanUsers,
      researchUsers,
      callReviewUsers,
      callScriptUsers,
      salesDeckUsers,
      emailSeqUsers,
      linkedInSeqUsers,
      salesMetricsUsers,
      coachingUsers,
    ] = await Promise.all([
      prisma.salesNarrativeVersion.groupBy({ by: ["userId"], where: { userId: { in: userIds } } }),
      prisma.discoveryQuestionsVersion.groupBy({ by: ["userId"], where: { userId: { in: userIds } } }),
      prisma.firstCallChecklistVersion.groupBy({ by: ["userId"], where: { userId: { in: userIds } } }),
      prisma.preCallPlanningVersion.groupBy({ by: ["userId"], where: { userId: { in: userIds } } }),
      prisma.preCallResearch.groupBy({ by: ["userId"], where: { userId: { in: userIds } } }),
      prisma.callReviewVersion.groupBy({ by: ["userId"], where: { userId: { in: userIds } } }),
      prisma.coldCallScriptVersion.groupBy({ by: ["userId"], where: { userId: { in: userIds } } }),
      prisma.salesDeckVersion.groupBy({ by: ["userId"], where: { userId: { in: userIds } } }),
      prisma.emailSequenceVersion.groupBy({ by: ["userId"], where: { userId: { in: userIds } } }),
      prisma.linkedInSequenceVersion.groupBy({ by: ["userId"], where: { userId: { in: userIds } } }),
      prisma.salesMetricsAssessment.groupBy({ by: ["userId"], where: { userId: { in: userIds } } }),
      prisma.coachingSession.groupBy({ by: ["userId"], where: { userId: { in: userIds } } }),
    ]);

    // Build sets for O(1) lookup
    const has = {
      narrative: new Set(narrativeUsers.map((r) => r.userId)),
      discoveryQuestions: new Set(discoveryUsers.map((r) => r.userId)),
      firstCallChecklist: new Set(checklistUsers.map((r) => r.userId)),
      preCallPlan: new Set(preCallPlanUsers.map((r) => r.userId)),
      researchReport: new Set(researchUsers.map((r) => r.userId)),
      callReview: new Set(callReviewUsers.map((r) => r.userId)),
      callScript: new Set(callScriptUsers.map((r) => r.userId)),
      salesDeck: new Set(salesDeckUsers.map((r) => r.userId)),
      emailSequence: new Set(emailSeqUsers.map((r) => r.userId)),
      linkedInSequence: new Set(linkedInSeqUsers.map((r) => r.userId)),
      salesMetrics: new Set(salesMetricsUsers.map((r) => r.userId)),
      coaching: new Set(coachingUsers.map((r) => r.userId)),
    };

    const TOTAL_ITEMS = 13; // 12 asset types + slack connection

    const result = users.map((u) => {
      const completion = {
        slackConnected: !!u.slackUserId && !!u.workspaceId,
        narrative: has.narrative.has(u.id),
        discoveryQuestions: has.discoveryQuestions.has(u.id),
        firstCallChecklist: has.firstCallChecklist.has(u.id),
        preCallPlan: has.preCallPlan.has(u.id),
        researchReport: has.researchReport.has(u.id),
        callReview: has.callReview.has(u.id),
        callScript: has.callScript.has(u.id),
        salesDeck: has.salesDeck.has(u.id),
        emailSequence: has.emailSequence.has(u.id),
        linkedInSequence: has.linkedInSequence.has(u.id),
        salesMetrics: has.salesMetrics.has(u.id),
        coaching: has.coaching.has(u.id),
      };
      const completionCount = Object.values(completion).filter(Boolean).length;

      return {
        id: u.id,
        email: u.email || u.slackEmail,
        name: u.name || u.slackUserName,
        avatarUrl: u.avatarUrl,
        licenseStatus: u.licenseStatus,
        workspaceName: u.workspace?.slackTeamName ?? null,
        createdAt: u.createdAt,
        lastActivity: u.lastActiveAt || u.conversations[0]?.lastMessageAt || u.updatedAt,
        completion,
        completionCount,
        completionTotal: TOTAL_ITEMS,
      };
    });

    return NextResponse.json({ users: result });
  } catch (error) {
    console.error("Admin users completion error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
