import { prisma } from "@/lib/db";

/**
 * Coaching artifacts (sessions, goals, tasks, metrics, comments)
 * are visible and editable to any user in the same account as the
 * artifact's owner. This helper centralizes the "can current user
 * mutate ownerUserId's coaching data?" check so individual API
 * routes don't reimplement it (and accidentally drift apart).
 *
 * Same-account = both users have a non-null accountId AND it
 * matches. Legacy solo users (no accountId) keep strict owner-only
 * access.
 */
export async function canEditOwnedBy(
  currentUserId: string,
  ownerUserId: string
): Promise<boolean> {
  if (currentUserId === ownerUserId) return true;
  const [currentUser, ownerUser] = await Promise.all([
    prisma.user.findUnique({
      where: { id: currentUserId },
      select: { accountId: true },
    }),
    prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { accountId: true },
    }),
  ]);
  if (!currentUser?.accountId || !ownerUser?.accountId) return false;
  return currentUser.accountId === ownerUser.accountId;
}
