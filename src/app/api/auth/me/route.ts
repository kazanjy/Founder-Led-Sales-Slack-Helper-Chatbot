import { NextResponse } from "next/server";
import { getCurrentUser, canUserChat } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  // Get workspace info
  const workspace = await prisma.workspace.findUnique({
    where: { id: user.workspaceId },
    select: { slackTeamName: true },
  });

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

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.slackUserName,
      email: user.slackEmail,
      workspaceName: workspace?.slackTeamName,
      licenseStatus: user.licenseStatus,
      trialDaysRemaining,
      canChat: chatStatus.allowed,
      chatBlockedMessage: chatStatus.message,
    },
  });
}
