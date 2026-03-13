import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

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

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        workspace: true,
        license: true,
        // Note: dismissedDefaultPromptIds is included by default (scalar field)
        conversations: {
          orderBy: { lastMessageAt: "desc" },
          take: 10,
          select: {
            id: true,
            title: true,
            firstMessagePreview: true,
            messageCount: true,
            source: true,
            createdAt: true,
            lastMessageAt: true,
          },
        },
        sessions: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            createdAt: true,
            expiresAt: true,
          },
        },
        _count: {
          select: {
            conversations: true,
            messages: true,
            referralsMade: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Fetch user's app activity (all version tables)
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
      coachingSessions,
      adCreatorVersions,
    ] = await Promise.all([
      prisma.salesNarrativeVersion.findMany({
        where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, title: true, createdAt: true },
      }),
      prisma.discoveryQuestionsVersion.findMany({
        where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, title: true, createdAt: true },
      }),
      prisma.firstCallChecklistVersion.findMany({
        where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, title: true, createdAt: true },
      }),
      prisma.preCallPlanningVersion.findMany({
        where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, title: true, createdAt: true },
      }),
      prisma.preCallResearch.findMany({
        where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, companyName: true, contactName: true, createdAt: true },
      }),
      prisma.emailSequenceVersion.findMany({
        where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, createdAt: true },
      }),
      prisma.linkedInSequenceVersion.findMany({
        where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, createdAt: true },
      }),
      prisma.coldCallScriptVersion.findMany({
        where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, createdAt: true },
      }),
      prisma.salesDeckVersion.findMany({
        where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, createdAt: true },
      }),
      prisma.callReviewVersion.findMany({
        where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, title: true, overallScore: true, maxScore: true, createdAt: true },
      }),
      prisma.maturityAssessment.findMany({
        where: { userId: id }, orderBy: { completedAt: "desc" }, take: 10,
        select: { id: true, title: true, completedAt: true },
      }),
      prisma.salesMetricsAssessment.findMany({
        where: { userId: id }, orderBy: { completedAt: "desc" }, take: 10,
        select: { id: true, title: true, completedAt: true },
      }),
      prisma.coachingSession.findMany({
        where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, title: true, createdAt: true },
      }),
      prisma.adCreatorVersion.findMany({
        where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, orgPersona: true, humanPersona: true, createdAt: true },
      }),
    ]);

    interface ActivityItem {
      id: string;
      type: string;
      label: string;
      title: string | null;
      link: string;
      createdAt: string;
    }

    const activityItems: ActivityItem[] = [];

    for (const r of narratives) {
      activityItems.push({ id: r.id, type: "narrative", label: "Generated Narrative", title: r.title, link: `/sales-narrative?version=${r.id}`, createdAt: r.createdAt.toISOString() });
    }
    for (const r of discoveryQuestions) {
      activityItems.push({ id: r.id, type: "discovery", label: "Generated Discovery Questions", title: r.title, link: `/discovery-questions?version=${r.id}`, createdAt: r.createdAt.toISOString() });
    }
    for (const r of firstCallChecklists) {
      activityItems.push({ id: r.id, type: "checklist", label: "Generated First Call Checklist", title: r.title, link: `/first-call-checklist?version=${r.id}`, createdAt: r.createdAt.toISOString() });
    }
    for (const r of preCallPlans) {
      activityItems.push({ id: r.id, type: "precall-plan", label: "Generated Pre-Call Plan", title: r.title, link: `/pre-call-planning?version=${r.id}`, createdAt: r.createdAt.toISOString() });
    }
    for (const r of preCallResearch) {
      activityItems.push({ id: r.id, type: "research", label: "Pre-Call Research", title: r.contactName ? `${r.companyName} — ${r.contactName}` : r.companyName, link: `/pre-call-planning/history?id=${r.id}`, createdAt: r.createdAt.toISOString() });
    }
    for (const r of emailSequences) {
      activityItems.push({ id: r.id, type: "email-sequence", label: "Generated Email Sequence", title: null, link: `/email-sequence?version=${r.id}`, createdAt: r.createdAt.toISOString() });
    }
    for (const r of linkedInSequences) {
      activityItems.push({ id: r.id, type: "linkedin-sequence", label: "Generated LinkedIn Sequence", title: null, link: `/linkedin-sequence?version=${r.id}`, createdAt: r.createdAt.toISOString() });
    }
    for (const r of coldCallScripts) {
      activityItems.push({ id: r.id, type: "cold-call", label: "Generated Call Script", title: null, link: `/call-scripts?version=${r.id}`, createdAt: r.createdAt.toISOString() });
    }
    for (const r of salesDecks) {
      activityItems.push({ id: r.id, type: "sales-deck", label: "Generated Sales Deck", title: null, link: `/sales-deck?version=${r.id}`, createdAt: r.createdAt.toISOString() });
    }
    for (const r of callReviews) {
      const score = r.overallScore != null && r.maxScore != null ? ` (${r.overallScore}/${r.maxScore})` : "";
      activityItems.push({ id: r.id, type: "call-review", label: "Call Review" + score, title: r.title, link: `/call-review?version=${r.id}`, createdAt: r.createdAt.toISOString() });
    }
    for (const r of maturityAssessments) {
      activityItems.push({ id: r.id, type: "maturity", label: "Completed GTM Assessment", title: r.title, link: "/maturity-history", createdAt: r.completedAt.toISOString() });
    }
    for (const r of salesMetricsAssessments) {
      activityItems.push({ id: r.id, type: "sales-metrics", label: "Completed Sales Metrics Analysis", title: r.title, link: `/sales-metrics/${r.id}`, createdAt: r.completedAt.toISOString() });
    }
    for (const r of coachingSessions) {
      activityItems.push({ id: r.id, type: "coaching", label: "Coaching Session", title: r.title, link: `/coaching`, createdAt: r.createdAt.toISOString() });
    }
    for (const r of adCreatorVersions) {
      activityItems.push({ id: r.id, type: "ad-creator", label: "Generated Ad Concepts", title: `${r.orgPersona} → ${r.humanPersona}`, link: `/ad-creator?version=${r.id}`, createdAt: r.createdAt.toISOString() });
    }

    activityItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Build completion checklist
    const completion = {
      slackConnected: !!user.slackUserId && !!user.workspaceId,
      narrative: narratives.length > 0,
      discoveryQuestions: discoveryQuestions.length > 0,
      firstCallChecklist: firstCallChecklists.length > 0,
      preCallPlan: preCallPlans.length > 0,
      researchReport: preCallResearch.length > 0,
      callReview: callReviews.length > 0,
      callScript: coldCallScripts.length > 0,
      salesDeck: salesDecks.length > 0,
      emailSequence: emailSequences.length > 0,
      linkedInSequence: linkedInSequences.length > 0,
      salesMetrics: salesMetricsAssessments.length > 0,
      coaching: coachingSessions.length > 0,
      adCreator: adCreatorVersions.length > 0,
    };
    const completionCount = Object.values(completion).filter(Boolean).length;
    const completionTotal = Object.keys(completion).length;

    // Calculate trial status
    let trialDaysRemaining = null;
    if (user.licenseStatus === "TRIAL" && user.trialStartedAt) {
      const TRIAL_DAYS = 7;
      const daysSinceStart = Math.floor(
        (Date.now() - user.trialStartedAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      trialDaysRemaining = Math.max(0, TRIAL_DAYS - daysSinceStart);
    }

    return NextResponse.json({
      user: {
        id: user.id,
        // Identity
        email: user.email,
        secondaryEmails: user.secondaryEmails,
        slackEmail: user.slackEmail,
        name: user.name,
        slackUserName: user.slackUserName,
        avatarUrl: user.avatarUrl,
        googleId: user.googleId,
        slackUserId: user.slackUserId,
        // Status
        licenseStatus: user.licenseStatus,
        trialStartedAt: user.trialStartedAt,
        trialDaysRemaining,
        // Workspace
        workspaceId: user.workspaceId,
        workspace: user.workspace
          ? {
              id: user.workspace.id,
              slackTeamId: user.workspace.slackTeamId,
              slackTeamName: user.workspace.slackTeamName,
              installedAt: user.workspace.installedAt,
            }
          : null,
        // License
        licenseId: user.licenseId,
        license: user.license
          ? {
              id: user.license.id,
              type: user.license.type,
              status: user.license.status,
              expiresAt: user.license.expiresAt,
              stripeCustomerId: user.license.stripeCustomerId,
              stripeSubscriptionId: user.license.stripeSubscriptionId,
              manuallyGranted: user.license.manuallyGranted,
              notes: user.license.notes,
            }
          : null,
        // Stats
        messagesToday: user.messagesToday,
        messageCountResetAt: user.messageCountResetAt,
        referralCode: user.referralCode,
        bonusMessagesEarned: user.bonusMessagesEarned,
        // Counts
        conversationCount: user._count.conversations,
        messageCount: user._count.messages,
        referralCount: user._count.referralsMade,
        // Prompt settings
        dismissedDefaultPromptIds: user.dismissedDefaultPromptIds,
        // Completion
        completion,
        completionCount,
        completionTotal,
        // Recent activity
        conversations: user.conversations,
        activity: activityItems.slice(0, 20),
        sessions: user.sessions,
        // Timestamps
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("Admin user detail error:", error);
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

    // Validate user exists
    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Build update data based on allowed fields
    const updateData: Record<string, unknown> = {};

    // License status change
    if (body.licenseStatus && ["TRIAL", "ACTIVE", "EXPIRED", "SUSPENDED"].includes(body.licenseStatus)) {
      updateData.licenseStatus = body.licenseStatus;
    }

    // Trial date changes
    if (body.trialStartedAt !== undefined) {
      updateData.trialStartedAt = body.trialStartedAt ? new Date(body.trialStartedAt) : null;
    }

    // Extend trial (add days to current trial)
    if (body.extendTrialDays && typeof body.extendTrialDays === "number") {
      const currentTrialStart = existingUser.trialStartedAt || new Date();
      const newTrialStart = new Date(currentTrialStart.getTime() + body.extendTrialDays * 24 * 60 * 60 * 1000);
      updateData.trialStartedAt = newTrialStart;
      updateData.licenseStatus = "TRIAL";
    }

    // Disconnect Slack
    if (body.disconnectSlack === true) {
      updateData.slackUserId = null;
      updateData.slackUserName = null;
      updateData.slackEmail = null;
      updateData.workspaceId = null;
    }

    // Disconnect Google
    if (body.disconnectGoogle === true) {
      updateData.googleId = null;
      // Keep email if it's from Slack
      if (!existingUser.slackEmail) {
        updateData.email = null;
      }
    }

    // Update name
    if (body.name !== undefined) {
      updateData.name = body.name || null;
    }

    // Update email (only if not conflicting)
    if (body.email !== undefined && body.email !== existingUser.email) {
      if (body.email) {
        // Check if email is already taken
        const existingEmail = await prisma.user.findUnique({
          where: { email: body.email },
        });
        if (existingEmail && existingEmail.id !== id) {
          return NextResponse.json(
            { error: "Email already in use by another user" },
            { status: 400 }
          );
        }
      }
      updateData.email = body.email || null;
    }

    // Reset dismissed default prompts
    if (body.resetDefaultPrompts === true) {
      updateData.dismissedDefaultPromptIds = [];
    }

    // Add secondary email
    if (body.addSecondaryEmail && typeof body.addSecondaryEmail === "string") {
      const emailToAdd = body.addSecondaryEmail.toLowerCase().trim();
      // Check if email is already used as primary email by another user
      const existingPrimary = await prisma.user.findFirst({
        where: {
          email: emailToAdd,
          id: { not: id }
        },
      });
      if (existingPrimary) {
        return NextResponse.json(
          { error: "Email already in use as primary email by another user" },
          { status: 400 }
        );
      }
      // Check if already in secondary emails
      if (!existingUser.secondaryEmails.includes(emailToAdd)) {
        updateData.secondaryEmails = [...existingUser.secondaryEmails, emailToAdd];
      }
    }

    // Remove secondary email
    if (body.removeSecondaryEmail && typeof body.removeSecondaryEmail === "string") {
      const emailToRemove = body.removeSecondaryEmail.toLowerCase().trim();
      updateData.secondaryEmails = existingUser.secondaryEmails.filter(
        (e: string) => e !== emailToRemove
      );
    }

    // Merge another user into this one (move all data, delete source user)
    if (body.mergeFromUserId && typeof body.mergeFromUserId === "string") {
      const sourceUser = await prisma.user.findUnique({
        where: { id: body.mergeFromUserId },
        include: {
          _count: {
            select: {
              conversations: true,
              messages: true,
            },
          },
        },
      });

      if (!sourceUser) {
        return NextResponse.json(
          { error: "Source user not found" },
          { status: 400 }
        );
      }

      if (sourceUser.id === id) {
        return NextResponse.json(
          { error: "Cannot merge user into itself" },
          { status: 400 }
        );
      }

      // Move all related data from source to target
      await prisma.$transaction([
        // Move conversations
        prisma.conversation.updateMany({
          where: { userId: sourceUser.id },
          data: { userId: id },
        }),
        // Move messages
        prisma.message.updateMany({
          where: { userId: sourceUser.id },
          data: { userId: id },
        }),
        // Move maturity answers
        prisma.maturityAnswer.updateMany({
          where: { userId: sourceUser.id },
          data: { userId: id },
        }),
        // Move maturity assessments
        prisma.maturityAssessment.updateMany({
          where: { userId: sourceUser.id },
          data: { userId: id },
        }),
        // Move sales narrative answers
        prisma.salesNarrativeAnswer.updateMany({
          where: { userId: sourceUser.id },
          data: { userId: id },
        }),
        // Move sales narrative versions
        prisma.salesNarrativeVersion.updateMany({
          where: { userId: sourceUser.id },
          data: { userId: id },
        }),
        // Move discovery questions versions
        prisma.discoveryQuestionsVersion.updateMany({
          where: { userId: sourceUser.id },
          data: { userId: id },
        }),
        // Move first call checklist versions
        prisma.firstCallChecklistVersion.updateMany({
          where: { userId: sourceUser.id },
          data: { userId: id },
        }),
        // Move ad creator versions
        prisma.adCreatorVersion.updateMany({
          where: { userId: sourceUser.id },
          data: { userId: id },
        }),
        // Move GTM variables
        prisma.gtmVariable.updateMany({
          where: { userId: sourceUser.id },
          data: { userId: id },
        }),
        // Move saved prompts
        prisma.savedPrompt.updateMany({
          where: { userId: sourceUser.id },
          data: { userId: id },
        }),
        // Delete sessions for source user
        prisma.session.deleteMany({
          where: { userId: sourceUser.id },
        }),
        // Delete the source user
        prisma.user.delete({
          where: { id: sourceUser.id },
        }),
      ]);

      // Add source user's email to secondary emails if not already there
      const emailsToAdd: string[] = [];
      if (sourceUser.email && !existingUser.secondaryEmails.includes(sourceUser.email) && sourceUser.email !== existingUser.email) {
        emailsToAdd.push(sourceUser.email);
      }
      if (sourceUser.slackEmail && !existingUser.secondaryEmails.includes(sourceUser.slackEmail) && sourceUser.slackEmail !== existingUser.email) {
        emailsToAdd.push(sourceUser.slackEmail);
      }
      if (emailsToAdd.length > 0) {
        updateData.secondaryEmails = [...existingUser.secondaryEmails, ...emailsToAdd];
      }

      console.log(`[Admin] Merged user ${sourceUser.id} (${sourceUser.email || sourceUser.slackEmail}) into ${id} (${existingUser.email || existingUser.slackEmail})`);
    }

    // Don't allow both disconnections if user would have no identity left
    if (body.disconnectSlack && body.disconnectGoogle) {
      return NextResponse.json(
        { error: "Cannot disconnect both identities - user would be orphaned" },
        { status: 400 }
      );
    }

    // Perform update
    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        licenseStatus: updatedUser.licenseStatus,
        trialStartedAt: updatedUser.trialStartedAt,
        slackUserId: updatedUser.slackUserId,
        googleId: updatedUser.googleId,
      },
    });
  } catch (error) {
    console.error("Admin user update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
