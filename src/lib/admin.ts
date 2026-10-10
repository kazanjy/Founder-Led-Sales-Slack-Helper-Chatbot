import { getCurrentUser, AuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Check if a user is an admin based on their email.
 * Admin emails are configured via ADMIN_EMAILS environment variable (comma-separated).
 */
export function isAdminEmail(email: string | null): boolean {
  if (!email) return false;

  const adminEmails = process.env.ADMIN_EMAILS?.split(",").map(e => e.trim().toLowerCase()) || [];
  return adminEmails.includes(email.toLowerCase());
}

/**
 * Returns true if any of the candidate emails match the admin list.
 * Used by getAdminUser so accounts that merged identities (e.g. a
 * Slack user with one address who later attached a Google account
 * with a different address) don't lose admin access just because
 * `user.email` happened to be filled with the non-admin identity.
 */
function anyEmailIsAdmin(emails: Array<string | null | undefined>): boolean {
  return emails.some((e) => (e ? isAdminEmail(e) : false));
}

/**
 * Check if the current user is an admin.
 * Returns the user if they are an admin, null otherwise.
 *
 * IMPORTANT: When impersonating, this checks if the REAL admin (the one doing
 * the impersonation) is an admin, not the impersonated user.
 */
export async function getAdminUser(): Promise<AuthUser | null> {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  // If impersonating, check if the real admin has admin privileges
  if (user.isImpersonating && user.impersonatingAdminId) {
    const realAdmin = await prisma.user.findUnique({
      where: { id: user.impersonatingAdminId },
      select: { email: true, slackEmail: true, secondaryEmails: true },
    });

    if (!realAdmin) {
      console.error(`[getAdminUser] Impersonation: real admin not found for id=${user.impersonatingAdminId}`);
      return null;
    }

    const realCandidates: Array<string | null> = [
      realAdmin.email,
      realAdmin.slackEmail,
      ...(realAdmin.secondaryEmails || []),
    ];
    if (!anyEmailIsAdmin(realCandidates)) {
      console.error(
        `[getAdminUser] Impersonation: none of real admin's emails [${realCandidates
          .filter(Boolean)
          .join(", ")}] are in ADMIN_EMAILS`
      );
      return null;
    }

    // Return the current user context (still impersonating) but admin access granted
    return user;
  }

  // Normal case: check every email we know about on the user row.
  // A user that has merged Slack + Google identities may have a
  // different value in user.email vs user.slackEmail; admins in
  // either column should still be admins.
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { secondaryEmails: true },
  });
  const candidates: Array<string | null> = [
    user.email,
    user.slackEmail,
    ...(row?.secondaryEmails || []),
  ];
  if (!anyEmailIsAdmin(candidates)) {
    return null;
  }

  return user;
}

/**
 * Require admin access - throws if not authenticated as admin.
 * Use this at the start of admin API routes.
 */
export async function requireAdmin(): Promise<AuthUser> {
  const admin = await getAdminUser();

  if (!admin) {
    throw new Error("Unauthorized: Admin access required");
  }

  return admin;
}
