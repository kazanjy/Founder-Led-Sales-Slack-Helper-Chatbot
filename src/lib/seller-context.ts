import { prisma } from "@/lib/db";

/**
 * The seller's positioning — sales narrative + 100-word value prop —
 * pulled from GTM variables. This is the "narrative default-on"
 * invariant: every model call that reasons over a founder's content
 * should see their positioning unless the user explicitly opts out.
 *
 * NOTE: the four agent run.ts files and coaching/synthesize.ts carry
 * older private copies of this helper (see capability-audit C1 —
 * shared agent runtime). New code should import from here; the
 * existing copies fold in when C1 lands.
 */
export interface SellerContext {
  narrative: string;
  valueProp100w: string;
}

/**
 * Read one GtmVariable for a user, falling back to an account-mate's
 * value when the user has none of their own.
 *
 * GtmVariable rows are keyed strictly by userId, so the playbook
 * belongs to whoever generated it. Everything account-scoped (the
 * narrative page, the playbook status counts) already reads
 * account-wide, so a teammate who didn't personally run the generator
 * would see the narrative in one place and "you have no narrative" in
 * another. This makes the merge fields agree with the rest.
 */
async function readAccountScopedVariable(
  userId: string,
  accountId: string | null,
  mergeField: string
): Promise<string> {
  const own = await prisma.gtmVariable.findFirst({
    where: { userId, mergeField },
    select: { value: true },
  });
  if (own?.value?.trim()) return own.value.trim();
  if (!accountId) return "";
  const teammate = await prisma.gtmVariable.findFirst({
    where: { mergeField, user: { accountId }, NOT: { value: null } },
    orderBy: { updatedAt: "desc" },
    select: { value: true },
  });
  return (teammate?.value || "").trim();
}

export async function loadSellerContext(userId: string): Promise<SellerContext> {
  // The caller only has a userId; resolve the account here so every
  // call site inherits account scoping without a signature change.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountId: true },
  });
  const accountId = user?.accountId ?? null;
  const [narrative, valueProp100w] = await Promise.all([
    readAccountScopedVariable(userId, accountId, "SALES_NARRATIVE"),
    readAccountScopedVariable(userId, accountId, "VALUE_PROP_100W"),
  ]);
  return { narrative, valueProp100w };
}

/**
 * Render seller context as a markdown block for prompt assembly, or
 * empty string when the founder hasn't authored either asset.
 */
export function formatSellerContext(seller: SellerContext): string {
  if (!seller.narrative && !seller.valueProp100w) return "";
  let out = `## Seller Context\n\n_The founder's own positioning — ground voice, terminology, and the value argument in this._\n\n`;
  if (seller.valueProp100w) out += `### Value prop (100w)\n${seller.valueProp100w}\n\n`;
  if (seller.narrative) out += `### Sales narrative\n${seller.narrative}\n\n`;
  return out;
}
