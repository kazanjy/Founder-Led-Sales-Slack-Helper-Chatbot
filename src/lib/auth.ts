import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export interface AuthUser {
  id: string;
  slackUserId: string | null;
  slackUserName: string | null;
  slackEmail: string | null;
  workspaceId: string | null;
  accountId: string | null;
  licenseStatus: string;
  trialStartedAt: Date | null;
  // Google OAuth fields
  googleId: string | null;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  // Maturity assessment update tracking
  maturityUpdateInProgress: boolean;
  maturityUpdateIndex: number | null;
  maturityUpdateStartedAt: Date | null;
  // Impersonation tracking
  isImpersonating: boolean;
  impersonatingAdminId: string | null;
}

/**
 * Get the currently authenticated user from session cookie
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session")?.value;

  if (!sessionToken) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { token: sessionToken },
    include: { user: true },
  });

  if (!session) {
    return null;
  }

  // Check if session is expired
  if (session.expiresAt < new Date()) {
    // Clean up expired session
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }

  return {
    id: session.user.id,
    slackUserId: session.user.slackUserId,
    slackUserName: session.user.slackUserName,
    slackEmail: session.user.slackEmail,
    workspaceId: session.user.workspaceId,
    accountId: session.user.accountId ?? null,
    licenseStatus: session.user.licenseStatus,
    trialStartedAt: session.user.trialStartedAt,
    googleId: session.user.googleId,
    email: session.user.email,
    name: session.user.name,
    avatarUrl: session.user.avatarUrl,
    maturityUpdateInProgress: session.user.maturityUpdateInProgress,
    maturityUpdateIndex: session.user.maturityUpdateIndex,
    maturityUpdateStartedAt: session.user.maturityUpdateStartedAt,
    isImpersonating: !!session.impersonatingAdminId,
    impersonatingAdminId: session.impersonatingAdminId,
  };
}

/**
 * Check if user can send messages (for web chat)
 */
export function canUserChat(user: AuthUser): {
  allowed: boolean;
  message: string;
} {
  const TRIAL_DAYS = 7;

  if (user.licenseStatus === "ACTIVE") {
    return { allowed: true, message: "" };
  }

  if (user.licenseStatus === "TRIAL") {
    const trialStart = user.trialStartedAt || new Date();
    const daysSinceStart = Math.floor(
      (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceStart >= TRIAL_DAYS) {
      return {
        allowed: false,
        message:
          "Your trial is all done! If you liked Mikey, go ahead and subscribe!",
      };
    }

    return { allowed: true, message: "" };
  }

  return {
    allowed: false,
    message:
      "Your trial is all done! If you liked Mikey, go ahead and subscribe!",
  };
}
