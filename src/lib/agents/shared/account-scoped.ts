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
 *
 * THREE TIERS, not two. User.accountId is NULLABLE, and a user created
 * from Slack very often has only workspaceId set. Falling back on
 * account alone therefore still leaves the exact reported failure in
 * place: the founder authors the AE Hiring Profile on the web, the
 * person typing in Slack is a different User row with no accountId,
 * and the lookup returns nothing. Slack workspace membership is a real
 * organizational boundary, so it is the last resort before giving up.
 */

export interface OrgScope {
  accountId?: string | null;
  workspaceId?: string | null;
}

/** Accepts a bare accountId for callers that only have that. */
function toScope(scope: string | null | undefined | OrgScope): OrgScope {
  if (!scope) return {};
  return typeof scope === "string" ? { accountId: scope } : scope;
}

/** Single-record read: own first, else the newest in the account. */
export async function findOwnThenAccount<T>(
  find: (where: Record<string, unknown>) => Promise<T | null>,
  userId: string,
  scope: string | null | undefined | OrgScope,
  extraWhere: Record<string, unknown> = {}
): Promise<T | null> {
  const own = await find({ userId, ...extraWhere });
  if (own) return own;
  const { accountId, workspaceId } = toScope(scope);
  if (accountId) {
    const inAccount = await find({ user: { accountId }, ...extraWhere });
    if (inAccount) return inAccount;
  }
  if (workspaceId) return find({ user: { workspaceId }, ...extraWhere });
  return null;
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
  scope: string | null | undefined | OrgScope,
  extraWhere: Record<string, unknown> = {}
): Promise<T[]> {
  const own = await find({ userId, ...extraWhere });
  if (own.length > 0) return own;
  const { accountId, workspaceId } = toScope(scope);
  if (accountId) {
    const inAccount = await find({ user: { accountId }, ...extraWhere });
    if (inAccount.length > 0) return inAccount;
  }
  if (workspaceId) return find({ user: { workspaceId }, ...extraWhere });
  return [];
}
