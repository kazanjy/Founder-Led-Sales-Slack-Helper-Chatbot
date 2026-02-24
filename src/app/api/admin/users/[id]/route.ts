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
        // Recent activity
        conversations: user.conversations,
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
