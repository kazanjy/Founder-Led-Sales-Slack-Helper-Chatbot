import { getCurrentUser, AuthUser } from "@/lib/auth";

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
 */
export async function getAdminUser(): Promise<AuthUser | null> {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  // Check if user's email is in the admin list
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
