/**
 * Own-record-first, then anything in the account.
 *
 * GTM artifacts — the sales narrative, ICP, discovery questions, first
 * call checklist, cold call scripts, objection library, sales deck,
 * maturity assessment — describe the COMPANY's playbook, not the
 * individual's. Reading them by userId alone means a teammate asking
 * Mikey in Slack gets "no ICP authored yet" while the founder's ICP
 * sits right there in the UI, and in claimed channels the speaker
 * isn't necessarily the author anyway.
 *
 * This is the same shape lib/seller-context.ts has always used, which
 * is exactly why the sales narrative kept working in Slack while the
 * hiring profile silently didn't.
 *
 * Deliberately NOT applied to coaching sessions, coaching notes or
 * deals. Those are personal or have their own claim/ownership model,
 * and widening their visibility is an access-control decision rather
 * than a bug fix.
 */

/** Single-record read: own first, else the newest in the account. */
export async function findOwnThenAccount<T>(
  find: (where: Record<string, unknown>) => Promise<T | null>,
  userId: string,
  accountId: string | null | undefined,
  extraWhere: Record<string, unknown> = {}
): Promise<T | null> {
  const own = await find({ userId, ...extraWhere });
  if (own || !accountId) return own;
  return find({ user: { accountId }, ...extraWhere });
}

/**
 * Collection read. Falls back only when the user's own set is EMPTY —
 * merging the two would produce a confusing mix of one person's
 * objections and another's, and "whose list am I looking at" needs a
 * single answer.
 */
export async function findManyOwnThenAccount<T>(
  find: (where: Record<string, unknown>) => Promise<T[]>,
  userId: string,
  accountId: string | null | undefined,
  extraWhere: Record<string, unknown> = {}
): Promise<T[]> {
  const own = await find({ userId, ...extraWhere });
  if (own.length > 0 || !accountId) return own;
  return find({ user: { accountId }, ...extraWhere });
}
