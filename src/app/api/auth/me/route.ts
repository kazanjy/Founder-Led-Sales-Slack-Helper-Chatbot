import { NextResponse } from "next/server";
import { getCurrentUser, canUserChat } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasGoogleCalendarScope } from "@/lib/google";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  // Get workspace info (only for Slack users)
  const workspace = user.workspaceId
    ? await prisma.workspace.findUnique({
        where: { id: user.workspaceId },
        select: { slackTeamName: true },
      })
    : null;

  // Calculate trial days remaining
  const TRIAL_DAYS = 7;
  let trialDaysRemaining = 0;
  if (user.licenseStatus === "TRIAL" && user.trialStartedAt) {
    const daysSinceStart = Math.floor(
      (Date.now() - user.trialStartedAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    trialDaysRemaining = Math.max(0, TRIAL_DAYS - daysSinceStart);
  }

  const chatStatus = canUserChat(user);

  // Get account domain for internal filtering
  let accountDomain: string | null = null;
  if (user.accountId) {
    const account = await prisma.account.findUnique({
      where: { id: user.accountId },
      select: { emailDomain: true },
    });
    accountDomain = account?.emailDomain || null;
  }

  // Calendar connection status — true only if we have BOTH a usable
  // refresh token AND a granted calendar scope. Existing Google users
  // who logged in before calendar scopes were added will read false
  // here and the UI can prompt them to reconnect.
  const googleTokenRow = user.googleId
    ? await prisma.user.findUnique({
        where: { id: user.id },
        select: { googleRefreshToken: true, googleScopes: true },
      })
    : null;
  const googleCalendarConnected =
    !!googleTokenRow?.googleRefreshToken &&
    hasGoogleCalendarScope(googleTokenRow.googleScopes);

  // Saved Slack destination for pre-call research broadcasts. Read
  // off the user row; null when the user hasn't picked one yet.
  const slackPrefRow = await prisma.user.findUnique({
    where: { id: user.id },
    select: { preferredResearchSlackChannelId: true, preferredResearchSlackChannelName: true },
  });

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name || user.slackUserName,
      email: user.email || user.slackEmail,
      avatarUrl: user.avatarUrl,
      workspaceName: workspace?.slackTeamName,
      licenseStatus: user.licenseStatus,
      trialDaysRemaining,
      canChat: chatStatus.allowed,
      chatBlockedMessage: chatStatus.message,
      isGoogleUser: !!user.googleId,
      isSlackUser: !!user.slackUserId,
      missingName: !user.name && !user.slackUserName,
      missingEmail: !user.email && !user.slackEmail,
      isImpersonating: user.isImpersonating,
      accountDomain,
      googleCalendarConnected,
      hasSlackDm: !!user.slackUserId && !!user.workspaceId,
      preferredResearchSlackChannelId: slackPrefRow?.preferredResearchSlackChannelId || null,
      preferredResearchSlackChannelName: slackPrefRow?.preferredResearchSlackChannelName || null,
    },
  });
}
