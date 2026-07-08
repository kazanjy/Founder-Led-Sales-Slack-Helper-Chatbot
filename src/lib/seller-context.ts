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

export async function loadSellerContext(userId: string): Promise<SellerContext> {
  const [narrativeRow, vp100Row] = await Promise.all([
    prisma.gtmVariable.findFirst({
      where: { userId, mergeField: "SALES_NARRATIVE" },
      select: { value: true },
    }),
    prisma.gtmVariable.findFirst({
      where: { userId, mergeField: "VALUE_PROP_100W" },
      select: { value: true },
    }),
  ]);
  return {
    narrative: (narrativeRow?.value || "").trim(),
    valueProp100w: (vp100Row?.value || "").trim(),
  };
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
