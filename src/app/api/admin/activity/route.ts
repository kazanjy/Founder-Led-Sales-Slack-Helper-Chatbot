import { NextResponse } from "next/server";
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
  workspaceName: string | null;
  createdAt: string;
}

const userSelect = {
  name: true,
  email: true,
  slackUserName: true,
  workspace: { select: { slackTeamName: true } },
} as const;

function userName(user: { name: string | null; slackUserName: string | null; email: string | null }): string | null {
  return user.name || user.slackUserName || user.email;
}

export async function GET() {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Query all version/action tables in parallel
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
    ] = await Promise.all([
      prisma.salesNarrativeVersion.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.discoveryQuestionsVersion.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.firstCallChecklistVersion.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.preCallPlanningVersion.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.preCallResearch.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, companyName: true, contactName: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.emailSequenceVersion.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.linkedInSequenceVersion.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.coldCallScriptVersion.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.salesDeckVersion.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.callReviewVersion.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, title: true, overallScore: true, maxScore: true, createdAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.maturityAssessment.findMany({
        orderBy: { completedAt: "desc" },
        take: 10,
        select: { id: true, title: true, completedAt: true, userId: true, user: { select: userSelect } },
      }),
      prisma.salesMetricsAssessment.findMany({
        orderBy: { completedAt: "desc" },
        take: 10,
        select: { id: true, title: true, completedAt: true, userId: true, user: { select: userSelect } },
      }),
    ]);

    const items: ActivityItem[] = [];

    for (const r of narratives) {
      items.push({
        id: r.id, type: "narrative", label: "Generated Narrative",
        title: r.title, link: `/sales-narrative`,
        userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
        workspaceName: r.user.workspace?.slackTeamName ?? null,
        createdAt: r.createdAt.toISOString(),
      });
    }

    for (const r of discoveryQuestions) {
      items.push({
        id: r.id, type: "discovery", label: "Generated Discovery Questions",
        title: r.title, link: `/discovery-questions`,
        userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
        workspaceName: r.user.workspace?.slackTeamName ?? null,
        createdAt: r.createdAt.toISOString(),
      });
    }

    for (const r of firstCallChecklists) {
      items.push({
        id: r.id, type: "checklist", label: "Generated First Call Checklist",
        title: r.title, link: `/first-call-checklist`,
        userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
        workspaceName: r.user.workspace?.slackTeamName ?? null,
        createdAt: r.createdAt.toISOString(),
      });
    }

    for (const r of preCallPlans) {
      items.push({
        id: r.id, type: "precall-plan", label: "Generated Pre-Call Plan",
        title: r.title, link: `/pre-call-planning`,
        userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
        workspaceName: r.user.workspace?.slackTeamName ?? null,
        createdAt: r.createdAt.toISOString(),
      });
    }

    for (const r of preCallResearch) {
      const researchTitle = r.contactName
        ? `${r.companyName} — ${r.contactName}`
        : r.companyName;
      items.push({
        id: r.id, type: "research", label: "Pre-Call Research",
        title: researchTitle, link: `/pre-call-planning`,
        userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
        workspaceName: r.user.workspace?.slackTeamName ?? null,
        createdAt: r.createdAt.toISOString(),
      });
    }

    for (const r of emailSequences) {
      items.push({
        id: r.id, type: "email-sequence", label: "Generated Email Sequence",
        title: null, link: `/email-sequence`,
        userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
        workspaceName: r.user.workspace?.slackTeamName ?? null,
        createdAt: r.createdAt.toISOString(),
      });
    }

    for (const r of linkedInSequences) {
      items.push({
        id: r.id, type: "linkedin-sequence", label: "Generated LinkedIn Sequence",
        title: null, link: `/linkedin-sequence`,
        userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
        workspaceName: r.user.workspace?.slackTeamName ?? null,
        createdAt: r.createdAt.toISOString(),
      });
    }

    for (const r of coldCallScripts) {
      items.push({
        id: r.id, type: "cold-call", label: "Generated Call Script",
        title: null, link: `/call-scripts`,
        userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
        workspaceName: r.user.workspace?.slackTeamName ?? null,
        createdAt: r.createdAt.toISOString(),
      });
    }

    for (const r of salesDecks) {
      items.push({
        id: r.id, type: "sales-deck", label: "Generated Sales Deck",
        title: null, link: `/sales-deck`,
        userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
        workspaceName: r.user.workspace?.slackTeamName ?? null,
        createdAt: r.createdAt.toISOString(),
      });
    }

    for (const r of callReviews) {
      const score = r.overallScore != null && r.maxScore != null
        ? ` (${r.overallScore}/${r.maxScore})`
        : "";
      items.push({
        id: r.id, type: "call-review", label: "Call Review" + score,
        title: r.title, link: `/call-review`,
        userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
        workspaceName: r.user.workspace?.slackTeamName ?? null,
        createdAt: r.createdAt.toISOString(),
      });
    }

    for (const r of maturityAssessments) {
      items.push({
        id: r.id, type: "maturity", label: "Completed GTM Assessment",
        title: r.title, link: `/assessment`,
        userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
        workspaceName: r.user.workspace?.slackTeamName ?? null,
        createdAt: r.completedAt.toISOString(),
      });
    }

    for (const r of salesMetricsAssessments) {
      items.push({
        id: r.id, type: "sales-metrics", label: "Completed Sales Metrics Analysis",
        title: r.title, link: `/sales-metrics`,
        userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
        workspaceName: r.user.workspace?.slackTeamName ?? null,
        createdAt: r.completedAt.toISOString(),
      });
    }

    // Sort all items by date descending and take most recent 30
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ activity: items.slice(0, 30) });
  } catch (error) {
    console.error("Admin activity error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
