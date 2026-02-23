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
      select: { email: true, slackEmail: true },
    });

    if (!realAdmin) {
      return null;
    }

    const adminEmail = realAdmin.email || realAdmin.slackEmail;
    if (!isAdminEmail(adminEmail)) {
      return null;
    }

    // Return the current user context (still impersonating) but admin access granted
    return user;
  }

  // Normal case: check if user's email is in the admin list
  const email = user.email || user.slackEmail;
  if (!isAdminEmail(email)) {
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
