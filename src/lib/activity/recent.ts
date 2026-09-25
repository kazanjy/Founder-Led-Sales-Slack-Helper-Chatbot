import { prisma } from "@/lib/db";

/**
 * Single normalized record describing one user-meaningful action across
 * the product. The admin Recent Activity feed and the Slack digest
 * broadcast both consume this shape.
 */
export interface ActivityItem {
  id: string;
  type: string;
  label: string;
  title: string | null;
  link: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  userAvatarUrl: string | null;
  workspaceName: string | null;
  createdAt: string;
}

const userSelect = {
  name: true,
  email: true,
  slackUserName: true,
  avatarUrl: true,
  workspace: { select: { slackTeamName: true } },
} as const;

function userName(u: { name: string | null; slackUserName: string | null; email: string | null }): string | null {
  return u.name || u.slackUserName || u.email;
}

interface FetchOpts {
  /** Only include items created on/after this timestamp. */
  since?: Date;
  /** Per-source cap. Sized to comfortably fill a paginated feed; the
   *  caller can slice further. */
  perType?: number;
}

/**
 * Pull the most recent activity from every capability surface. Returns
 * items sorted newest-first. Capability set must stay in sync with the
 * features Mikey ships — when a new versioned model lands, add a
 * matching block here so it appears in the admin feed and the Slack
 * digest.
 */
export async function fetchRecentActivity(opts: FetchOpts = {}): Promise<ActivityItem[]> {
  const perType = Math.max(opts.perType ?? 30, 30);
  const since = opts.since;

  // Apply `since` to whichever timestamp column drives ordering for the
  // model. For the assessment models that sort by completedAt we filter
  // on that, otherwise we filter on createdAt.
  const sinceCreated = since ? { gte: since } : undefined;
  const sinceCompleted = since ? { gte: since } : undefined;

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
    socialContentVersions,
    icpVersions,
    hiringProfileVersions,
    salesLeaderProfileVersions,
    preHireAssessmentVersions,
    callRecapVersions,
    coachingSessionsLocked,
    objectionBootstraps,
    broadcastCampaigns,
    deals,
  ] = await Promise.all([
    prisma.salesNarrativeVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.discoveryQuestionsVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.firstCallChecklistVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.preCallPlanningVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.preCallResearch.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, companyName: true, contactName: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.emailSequenceVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.linkedInSequenceVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.coldCallScriptVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.salesDeckVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.callReviewVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, title: true, overallScore: true, maxScore: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.maturityAssessment.findMany({
      where: sinceCompleted ? { completedAt: sinceCompleted } : undefined,
      orderBy: { completedAt: "desc" },
      take: perType,
      select: { id: true, title: true, completedAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.salesMetricsAssessment.findMany({
      where: sinceCompleted ? { completedAt: sinceCompleted } : undefined,
      orderBy: { completedAt: "desc" },
      take: perType,
      select: { id: true, title: true, completedAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.adCreatorVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, orgPersona: true, humanPersona: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.socialContentVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, title: true, platform: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.icpVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.hiringProfileVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.salesLeaderProfileVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.preHireAssessmentVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, title: true, roleType: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.callRecapVersion.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, title: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.coachingSession.findMany({
      where: {
        sessionStatus: "locked",
        ...(sinceCreated ? { createdAt: sinceCreated } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, title: true, sessionDate: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.objectionBootstrap.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
    prisma.broadcastCampaign.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: {
        id: true,
        name: true,
        createdAt: true,
        createdByAdminId: true,
        createdByAdmin: { select: userSelect },
        workspace: { select: { slackTeamName: true } },
        _count: { select: { deliveries: true } },
      },
    }),
    prisma.deal.findMany({
      where: sinceCreated ? { createdAt: sinceCreated } : undefined,
      orderBy: { createdAt: "desc" },
      take: perType,
      select: { id: true, name: true, companyName: true, createdAt: true, userId: true, user: { select: userSelect } },
    }),
  ]);

  const items: ActivityItem[] = [];

  for (const r of narratives) {
    items.push({
      id: r.id, type: "narrative", label: "Generated Narrative",
      title: r.title, link: `/sales-narrative?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of discoveryQuestions) {
    items.push({
      id: r.id, type: "discovery", label: "Generated Discovery Questions",
      title: r.title, link: `/discovery-questions?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of firstCallChecklists) {
    items.push({
      id: r.id, type: "checklist", label: "Generated First Call Checklist",
      title: r.title, link: `/first-call-checklist?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of preCallPlans) {
    items.push({
      id: r.id, type: "precall-plan", label: "Generated Pre-Call Plan",
      title: r.title, link: `/pre-call-planning?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of preCallResearch) {
    const researchTitle = r.contactName ? `${r.companyName} — ${r.contactName}` : r.companyName;
    items.push({
      id: r.id, type: "research", label: "Pre-Call Research",
      title: researchTitle, link: `/pre-call-planning/history?id=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of emailSequences) {
    items.push({
      id: r.id, type: "email-sequence", label: "Generated Email Sequence",
      title: null, link: `/email-sequence?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of linkedInSequences) {
    items.push({
      id: r.id, type: "linkedin-sequence", label: "Generated LinkedIn Sequence",
      title: null, link: `/linkedin-sequence?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of coldCallScripts) {
    items.push({
      id: r.id, type: "cold-call", label: "Generated Call Script",
      title: null, link: `/call-scripts?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of salesDecks) {
    items.push({
      id: r.id, type: "sales-deck", label: "Generated Sales Deck",
      title: null, link: `/sales-deck?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of callReviews) {
    const score = r.overallScore != null && r.maxScore != null ? ` (${r.overallScore}/${r.maxScore})` : "";
    items.push({
      id: r.id, type: "call-review", label: "Call Review" + score,
      title: r.title, link: `/call-review?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of maturityAssessments) {
    items.push({
      id: r.id, type: "maturity", label: "Completed GTM Assessment",
      title: r.title, link: `/maturity-history`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.completedAt.toISOString(),
    });
  }
  for (const r of salesMetricsAssessments) {
    items.push({
      id: r.id, type: "sales-metrics", label: "Completed Sales Metrics Analysis",
      title: r.title, link: `/sales-metrics/${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.completedAt.toISOString(),
    });
  }
  for (const r of adCreatorVersions) {
    items.push({
      id: r.id, type: "ad-creator", label: "Generated Ad Concepts",
      title: `${r.orgPersona} → ${r.humanPersona}`, link: `/ad-creator?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of socialContentVersions) {
    const t = r.title || (r.platform === "linkedin" ? "LinkedIn posts" : r.platform === "twitter" ? "Twitter posts" : "Social posts");
    items.push({
      id: r.id, type: "social-content", label: "Generated Social Content",
      title: t, link: `/social-content?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of icpVersions) {
    items.push({
      id: r.id, type: "icp", label: "Generated ICP",
      title: r.title, link: `/icp?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of hiringProfileVersions) {
    items.push({
      id: r.id, type: "hiring-profile", label: "Generated Hiring Profile",
      title: r.title, link: `/hiring-profile?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of salesLeaderProfileVersions) {
    items.push({
      id: r.id, type: "sales-leader-profile", label: "Generated Sales Leader Profile",
      title: r.title, link: `/sales-leader-profile?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of preHireAssessmentVersions) {
    items.push({
      id: r.id, type: "pre-hire-assessment", label: "Generated Pre-Hire Assessment",
      title: r.title, link: `/pre-hire-assessment?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of callRecapVersions) {
    items.push({
      id: r.id, type: "call-recap", label: "Generated Call Recap",
      title: r.title, link: `/call-recap?version=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of coachingSessionsLocked) {
    items.push({
      id: r.id, type: "coaching-session", label: "Locked Coaching Session",
      title: r.title, link: `/coaching-history?session=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of objectionBootstraps) {
    items.push({
      id: r.id, type: "objections", label: "Bootstrapped Objection Library",
      title: null, link: `/objection-library`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of broadcastCampaigns) {
    const channelCount = r._count.deliveries;
    const t = r.name || `${channelCount} channel${channelCount === 1 ? "" : "s"}`;
    items.push({
      id: r.id, type: "broadcast", label: "Sent Broadcast",
      title: t, link: `/admin/channels`,
      userId: r.createdByAdminId, userName: userName(r.createdByAdmin), userEmail: r.createdByAdmin.email,
      userAvatarUrl: r.createdByAdmin.avatarUrl ?? null, workspaceName: r.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const r of deals) {
    items.push({
      id: r.id, type: "deal", label: "Created Deal",
      title: r.name || r.companyName, link: `/deals?deal=${r.id}`,
      userId: r.userId, userName: userName(r.user), userEmail: r.user.email,
      userAvatarUrl: r.user.avatarUrl ?? null, workspaceName: r.user.workspace?.slackTeamName ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return items;
}
