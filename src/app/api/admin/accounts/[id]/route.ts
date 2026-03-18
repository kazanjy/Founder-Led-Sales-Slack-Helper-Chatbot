import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

interface ActivityItem {
  id: string;
  type: string;
  label: string;
  title: string | null;
  link: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  userAvatarUrl: string | null;
  createdAt: string;
}

const userSelect = {
  name: true,
  email: true,
  slackUserName: true,
  avatarUrl: true,
} as const;

function displayName(user: { name: string | null; slackUserName: string | null; email: string | null }): string | null {
  return user.name || user.slackUserName || user.email;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const account = await prisma.account.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            slackUserName: true,
            slackUserId: true,
            avatarUrl: true,
            accountRole: true,
            licenseStatus: true,
            workspaceId: true,
            workspace: {
              select: { id: true, slackTeamName: true },
            },
            _count: {
              select: { conversations: true, messages: true },
            },
            createdAt: true,
          },
          orderBy: { accountRole: "asc" },
        },
        channelClaims: {
          include: {
            claimedBy: {
              select: { id: true, name: true, email: true, slackUserName: true },
            },
            workspace: {
              select: { id: true, slackTeamName: true },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Fetch activity for all users in this account
    const userIds = account.users.map((u) => u.id);

    const [
      narratives,
      discoveryQuestions,
      firstCallChecklists,
      preCallPlans,
      preCallResearch,
      emailSequences,
      linkedInSequences,
      coldCallScripts,
      salesDecks,
      callReviews,
      maturityAssessments,
      salesMetricsAssessments,
      adCreatorVersions,
      conversations,
      coachingSessions,
    ] = await Promise.all([
      prisma.salesNarrativeVersion.findMany({
        where: { userId: { in: userIds } }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.discoveryQuestionsVersion.findMany({
        where: { userId: { in: userIds } }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.firstCallChecklistVersion.findMany({
        where: { userId: { in: userIds } }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.preCallPlanningVersion.findMany({
        where: { userId: { in: userIds } }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.preCallResearch.findMany({
        where: { userId: { in: userIds } }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, companyName: true, contactName: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.emailSequenceVersion.findMany({
        where: { userId: { in: userIds } }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.linkedInSequenceVersion.findMany({
        where: { userId: { in: userIds } }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.coldCallScriptVersion.findMany({
        where: { userId: { in: userIds } }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.salesDeckVersion.findMany({
        where: { userId: { in: userIds } }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.callReviewVersion.findMany({
        where: { userId: { in: userIds } }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, title: true, overallScore: true, maxScore: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.maturityAssessment.findMany({
        where: { userId: { in: userIds } }, orderBy: { completedAt: "desc" }, take: 10,
        select: { id: true, title: true, completedAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.salesMetricsAssessment.findMany({
        where: { userId: { in: userIds } }, orderBy: { completedAt: "desc" }, take: 10,
        select: { id: true, title: true, completedAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.adCreatorVersion.findMany({
        where: { userId: { in: userIds } }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, orgPersona: true, humanPersona: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.conversation.findMany({
        where: { userId: { in: userIds } }, orderBy: { lastMessageAt: "desc" }, take: 15,
        select: { id: true, firstMessagePreview: true, source: true, messageCount: true, createdAt: true, lastMessageAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.coachingSession.findMany({
        where: { userId: { in: userIds } }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
    ]);

    const items: ActivityItem[] = [];

    for (const r of narratives) {
      items.push({ id: r.id, type: "narrative", label: "Generated Narrative", title: r.title, link: `/sales-narrative?version=${r.id}`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.createdAt.toISOString() });
    }
    for (const r of discoveryQuestions) {
      items.push({ id: r.id, type: "discovery", label: "Generated Discovery Questions", title: r.title, link: `/discovery-questions?version=${r.id}`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.createdAt.toISOString() });
    }
    for (const r of firstCallChecklists) {
      items.push({ id: r.id, type: "checklist", label: "Generated First Call Checklist", title: r.title, link: `/first-call-checklist?version=${r.id}`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.createdAt.toISOString() });
    }
    for (const r of preCallPlans) {
      items.push({ id: r.id, type: "precall-plan", label: "Generated Pre-Call Plan", title: r.title, link: `/pre-call-planning?version=${r.id}`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.createdAt.toISOString() });
    }
    for (const r of preCallResearch) {
      const researchTitle = r.contactName ? `${r.companyName} — ${r.contactName}` : r.companyName;
      items.push({ id: r.id, type: "research", label: "Pre-Call Research", title: researchTitle, link: `/pre-call-planning/history?id=${r.id}`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.createdAt.toISOString() });
    }
    for (const r of emailSequences) {
      items.push({ id: r.id, type: "email-sequence", label: "Generated Email Sequence", title: null, link: `/email-sequence?version=${r.id}`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.createdAt.toISOString() });
    }
    for (const r of linkedInSequences) {
      items.push({ id: r.id, type: "linkedin-sequence", label: "Generated LinkedIn Sequence", title: null, link: `/linkedin-sequence?version=${r.id}`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.createdAt.toISOString() });
    }
    for (const r of coldCallScripts) {
      items.push({ id: r.id, type: "cold-call", label: "Generated Call Script", title: null, link: `/call-scripts?version=${r.id}`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.createdAt.toISOString() });
    }
    for (const r of salesDecks) {
      items.push({ id: r.id, type: "sales-deck", label: "Generated Sales Deck", title: null, link: `/sales-deck?version=${r.id}`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.createdAt.toISOString() });
    }
    for (const r of callReviews) {
      const score = r.overallScore != null && r.maxScore != null ? ` (${r.overallScore}/${r.maxScore})` : "";
      items.push({ id: r.id, type: "call-review", label: "Call Review" + score, title: r.title, link: `/call-review?version=${r.id}`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.createdAt.toISOString() });
    }
    for (const r of maturityAssessments) {
      items.push({ id: r.id, type: "maturity", label: "Completed GTM Assessment", title: r.title, link: `/maturity-history`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.completedAt.toISOString() });
    }
    for (const r of salesMetricsAssessments) {
      items.push({ id: r.id, type: "sales-metrics", label: "Completed Sales Metrics Analysis", title: r.title, link: `/sales-metrics/${r.id}`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.completedAt.toISOString() });
    }
    for (const r of adCreatorVersions) {
      items.push({ id: r.id, type: "ad-creator", label: "Generated Ad Concepts", title: `${r.orgPersona} → ${r.humanPersona}`, link: `/ad-creator?version=${r.id}`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.createdAt.toISOString() });
    }
    for (const r of conversations) {
      const sourceLabel = r.source === "SLACK" ? "Slack Chat" : r.source === "WEB" ? "Web Chat" : "Chat";
      const chatType = r.source === "SLACK" ? "slack-chat" : r.source === "WEB" ? "web-chat" : "chat";
      items.push({ id: r.id, type: chatType, label: sourceLabel, title: r.firstMessagePreview, link: `/chat/${r.id}`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: (r.lastMessageAt || r.createdAt).toISOString() });
    }
    for (const r of coachingSessions) {
      items.push({ id: r.id, type: "coaching", label: "Coaching Session", title: r.title, link: `/coaching`, userId: r.userId, userName: displayName(r.user), userEmail: r.user.email, userAvatarUrl: r.user.avatarUrl ?? null, createdAt: r.createdAt.toISOString() });
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({
      account,
      activity: items.slice(0, 30),
    });
  } catch (error) {
    console.error("Admin account detail error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const account = await prisma.account.findUnique({ where: { id } });
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Add user to account
    if (body.addUserId && typeof body.addUserId === "string") {
      const role = body.role || "MEMBER";
      const user = await prisma.user.findUnique({ where: { id: body.addUserId } });
      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 400 });
      }
      await prisma.user.update({
        where: { id: body.addUserId },
        data: { accountId: id, accountRole: role },
      });
      return NextResponse.json({ success: true });
    }

    // Remove user from account
    if (body.removeUserId && typeof body.removeUserId === "string") {
      await prisma.user.update({
        where: { id: body.removeUserId },
        data: { accountId: null, accountRole: "MEMBER" },
      });
      return NextResponse.json({ success: true });
    }

    // Update user role in account
    if (body.updateUserRole && body.userId) {
      await prisma.user.update({
        where: { id: body.userId },
        data: { accountRole: body.updateUserRole },
      });
      return NextResponse.json({ success: true });
    }

    // Update account name
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      }
      await prisma.account.update({
        where: { id },
        data: { name },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "No valid action provided" }, { status: 400 });
  } catch (error) {
    console.error("Admin account update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
