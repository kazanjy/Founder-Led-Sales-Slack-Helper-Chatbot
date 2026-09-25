import { ROLE_META, type HiringRoleType } from "./role-types";

/**
 * Role-specific framing for hiring profile generation.
 *
 * The report SKELETON is shared — role summary, background, must-haves,
 * where to look, red flags, interview focus, comp — because a founder
 * reading three profiles should find the same shape in each. What
 * changes per seat is what "good background" means, where those people
 * are, how they're paid, and which failure mode the profile most needs
 * to warn about. Those are the parts a generic prompt gets wrong.
 */

interface RolePromptParts {
  /** One line establishing what decision this profile serves. */
  intro: string;
  /** What to say under "Ideal Background". */
  background: string;
  /** Sourcing guidance — where these people actually are. */
  whereToLook: string;
  /** The failure mode this seat most often produces. */
  redFlags: string;
  /** How this seat is typically paid. */
  comp: string;
  /** One section unique to this seat, appended before comp. */
  extraSection?: { heading: string; guidance: string };
}

const PARTS: Record<HiringRoleType, RolePromptParts> = {
  AE: {
    intro:
      "helping a founder define their ideal first (or next) Account Executive hire — the rep who will run deals end to end and carry a closing number",
    background:
      "Industries, company stages, deal sizes, selling experience that translates well. Be specific. Name 5-10 specific companies that are exemplars of each org type you recommend (e.g., \"AEs from Gong, Outreach, or Salesloft who sold $30-80K ACV deals into VP Sales buyers\").",
    whereToLook:
      "Name 10-15 specific companies to source candidates from, organized by category (direct competitors, adjacent markets, similar sales motions). Include LinkedIn search criteria, communities, events, and sourcing channels.",
    redFlags:
      "Backgrounds that look good but are bad fits. Explain WHY each is a red flag. Give particular weight to the classic first-AE failure: someone whose numbers were produced by brand, inbound, an SDR team and an SE, none of which will exist here.",
    comp: "Suggested OTE range and base/variable split with reasoning. Note the typical 50/50 split and where this role should sit relative to it.",
  },

  SDR: {
    intro:
      "helping a founder define their ideal Sales Development Rep hire — the person who will create pipeline through outbound, qualify inbound, and book meetings",
    background:
      "What actually predicts SDR success, which is often NOT prior SDR experience. Weight demonstrated rejection tolerance and coachability heavily: university phonathon / annual fund calling, commission-only direct sales (Cutco/Vector, Southwestern), door-to-door, competitive or professional athletics, military service, hospitality and restaurant work, and working through school. Name 5-10 exemplar companies for candidates who DO have SDR experience, and be explicit about which non-traditional backgrounds you would take over a mediocre SDR-titled candidate.",
    whereToLook:
      "Name 10-15 specific sources, organized by category: companies with strong SDR programs whose reps are ready to move up, adjacent industries with high-volume phone work, university career centers and phonathon programs, and the direct-sales programs above. Include LinkedIn search criteria and the communities where SDRs actually congregate.",
    redFlags:
      "Backgrounds that look good but are bad fits. Be blunt about the two that matter most here: (1) phone-averse candidates, which is common and much easier to screen for than to fix, and (2) SDRs whose meeting numbers came from warm inbound at a company with a strong brand, which does not transfer to cold outbound for an unknown one. Also flag the founder-side failure — hiring an SDR to fix a message the founder has not yet made work.",
    comp:
      "Suggested OTE range and base/variable split with reasoning. SDRs typically run 65/35 or 70/30 base-to-variable. State explicitly what the variable should pay on — meetings booked, meetings held, or opportunities accepted — and note that this choice drives behaviour more than the dollar amount does.",
    extraSection: {
      heading: "Ramp & Activity Expectations",
      guidance:
        "Week-by-week for the first 90 days: what activity looks like, when they should be at full volume, and when conversion should stabilize. Separate ramping ACTIVITY (weeks) from ramping CONVERSION (months) — conflating them is how founders conclude too early that an SDR isn't working.",
    },
  },

  CSM: {
    intro:
      "helping a founder define their ideal Customer Success Manager hire — the person who onboards, retains and expands customers after the sale",
    background:
      "Be explicit that \"CSM\" covers four different jobs — support, onboarding/implementation, adoption, and a quota-carrying renewal/expansion seat — and that the right background depends entirely on which of those this role actually is. Say which one this founder is describing, based on their answers, before recommending backgrounds. Name 5-10 exemplar companies, and be clear about when a support or implementation background beats a CSM-titled one.",
    whereToLook:
      "Name 10-15 specific companies to source from, organized by category: companies with similar product complexity and account load, adjacent industries with the same buyer, and support/implementation orgs where the work matches. Include LinkedIn search criteria and the CS communities worth posting in.",
    redFlags:
      "Backgrounds that look good but are bad fits. Cover: CSMs from companies where the product sold itself and the job was really account admin; candidates who have never had a commercial conversation being placed in a seat that owns renewals or price; and CSMs from very high-touch enterprise moving to a large scaled book, or the reverse. Explain WHY each fails.",
    comp:
      "Suggested OTE range and base/variable split with reasoning. Note that this differs sharply by whether the seat carries a number: a non-quota CSM typically runs 80/20 or is salaried, while a renewal/expansion-owning CSM looks closer to an AE. State which applies here.",
    extraSection: {
      heading: "Scope Definition",
      guidance:
        "State plainly what this role owns and what it does NOT: onboarding, support escalations, renewals, expansion, product feedback. This is the section that prevents a mis-hire, because the same title covers wildly different jobs and candidates self-select on it. Include the expected split between reactive and proactive work.",
    },
  },
};

export function buildHiringProfilePrompt(
  roleType: HiringRoleType,
  answersSummary: string,
  additionalContext: string,
  guidance: string
): string {
  const parts = PARTS[roleType];
  const meta = ROLE_META[roleType];
  const extra = parts.extraSection
    ? `\n\n## ${parts.extraSection.heading}\n${parts.extraSection.guidance}`
    : "";

  return `You are an expert sales hiring consultant ${parts.intro}. Based on the founder's answers below, generate a comprehensive ${meta.profileTitle} report.

## QUESTIONNAIRE ANSWERS:

${answersSummary}

${additionalContext}

---

Generate a detailed ${meta.profileTitle} report in Markdown with these sections (use ## headings):

## Role Summary
2-3 paragraphs: the ${meta.short} role, the motion, target market, and what makes this role unique at this company.

## Ideal Background
${parts.background}

## Must-Have Experience
Bullet list of non-negotiable experience/skills tied to the founder's actual motion.

## Nice-to-Have Experience
Bullet list of valuable but not required experience.

## Where to Look
${parts.whereToLook} Be as concrete as possible — real company names, not generic descriptions.

## Red Flags
${parts.redFlags}

## Interview Focus Areas
Key areas to probe with suggested questions or evaluation criteria.${extra}

## Comp Expectations
${parts.comp}

Be specific and actionable — avoid generic advice.${guidance ? `\n\n## ADDITIONAL GUIDANCE FROM USER:\n\n${guidance}` : ""}

Output ONLY the markdown report, no JSON wrapping.`;
}

export function buildTitlePrompt(roleType: HiringRoleType, content: string): string {
  const meta = ROLE_META[roleType];
  return `Based on this ${meta.short} hiring profile, generate a short title in the format "${meta.profileTitle} - [brief descriptor]". Respond with ONLY the title.\n\n${content.substring(0, 2000)}`;
}
