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
 * SCOPE PRECEDENCE, and the order matters enormously.
 *
 * When an accountId is known it is the ONLY scope. We do not check the
 * caller's own row first, and we do not fall through to the workspace.
 *
 * Own-row-first looks harmless and is not. A user can belong to one
 * account while having authored artifacts under a different one — an
 * admin who impersonated into two customer orgs ends up owning a
 * HiringProfileVersion in each. "Newest row this user authored
 * anywhere" then returns whichever org they touched most recently,
 * which is how an assessment in one customer's Slack channel got
 * graded against a DIFFERENT customer's hiring profile. Cross-tenant
 * leakage, produced by a fallback meant to be helpful.
 *
 * The account is the tenant boundary, so if we know it we honour it
 * strictly and return nothing rather than something from elsewhere.
 * The web app's /api/hiring-profile/latest has always scoped this way.
 *
 * The own -> workspace path applies ONLY when there is no accountId:
 * User.accountId is nullable and a Slack-created user often has just a
 * workspaceId, which was the original "founder authored it, teammate
 * can't see it" bug. Workspace is a weaker boundary than account, so
 * it is a last resort for accountless users and never an override.
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
  const { accountId, workspaceId } = toScope(scope);
  // Account known: that is the tenant boundary, full stop.
  if (accountId) return find({ user: { accountId }, ...extraWhere });
  const own = await find({ userId, ...extraWhere });
  if (own) return own;
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
  const { accountId, workspaceId } = toScope(scope);
  if (accountId) return find({ user: { accountId }, ...extraWhere });
  const own = await find({ userId, ...extraWhere });
  if (own.length > 0) return own;
  if (workspaceId) return find({ user: { workspaceId }, ...extraWhere });
  return [];
}
