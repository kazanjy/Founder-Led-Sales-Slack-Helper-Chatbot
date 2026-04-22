import { NextResponse } from "next/server";
import { getCurrentUser, canUserChat } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
    },
  });
}
