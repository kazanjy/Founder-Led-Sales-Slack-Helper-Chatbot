/**
 * Prompt builders for the Business Cases suite. Server-side only in
 * practice (imported by generate.ts), but kept import-clean so tests
 * or client previews could read the defaults.
 *
 * Phase 1 implements discovery_summary; the other two types land in
 * Phases 2–3 (see business-cases-plan.md).
 */

/**
 * Fallback skeleton used when the founder hasn't generated/authored a
 * Discovery Summary template yet. Deliberately generic — the whole
 * point of the template step is to replace this with a skeleton shaped
 * by THEIR discovery questions.
 */
export const DEFAULT_DISCOVERY_SUMMARY_TEMPLATE = `# Discovery Summary — {{COMPANY_NAME}}

_Prepared {{DATE}} · based on {{EVIDENCE_SOURCES}}_

## Current situation
_What the account looks like today: team, tooling, process, scale. Evidence-grounded._

## Pains & triggers
_The specific problems driving this evaluation, and the event(s) that made now the moment. Quote the customer where possible._

## Quantified impact
_What the pain costs them — time, money, risk — using THEIR numbers where surfaced. Leave {{PLACEHOLDER}} slots where discovery hasn't produced a number yet._

## Stakeholders
_Who's involved, their role in the decision (champion / economic buyer / influencer / blocker), and what each cares about._

## Decision process & timeline
_How they buy: steps, approvers, procurement/security gates, target dates._

## Competition & alternatives
_Other options they're weighing, including status quo / build-it-themselves._

## Fit against our approach
_How what we've learned maps to our value proposition — strong fits and stretches._

## Open discovery gaps
_The important things we still DON'T know, phrased as the questions to ask next._
`;

/**
 * Build the prompt that generates a founder's Discovery Summary
 * TEMPLATE from their playbook assets. The output is a reusable
 * markdown skeleton (sections + per-section guidance + placeholder
 * slots), NOT a filled-in document.
 */
export function buildDiscoveryTemplatePrompt(inputs: {
  sellerContext: string; // formatted seller-context block (may be "")
  discoveryQuestions: string; // formatted "## Category\n- q" listing (may be "")
  firstCallChecklist: string; // raw checklist markdown (may be "")
}): string {
  const parts: string[] = [];
  parts.push(`You are building a reusable DISCOVERY SUMMARY TEMPLATE for a founder doing founder-led sales. The template will later be filled in per-deal from call transcripts and deal history — so produce a skeleton, not a filled document.

Requirements:
- Markdown. Start with a title line: "# Discovery Summary — {{COMPANY_NAME}}" and a subtitle line "_Prepared {{DATE}} · based on {{EVIDENCE_SOURCES}}_".
- Derive the section structure from the founder's OWN discovery framework below: their discovery question categories become sections (merge/rename for flow where sensible), so a filled summary demonstrates coverage of what THEY probe for. Fold in any first-call checklist structure that adds sections their questions miss.
- Always include these sections even if their framework doesn't name them: Stakeholders; Decision process & timeline; Fit against our approach (framed in the language of their value proposition); Open discovery gaps.
- Under each section heading, write 1–2 italic guidance lines (what evidence fills this section, what good looks like) — these guide the fill model and the founder's own edits.
- Use {{PLACEHOLDER}} tokens for customer-specific values a filled summary would need (e.g. {{CURRENT_TOOL_COST}}, {{TEAM_SIZE}}) where a number naturally belongs.
- Keep it tight: 8-12 sections max. No preamble, no commentary — return ONLY the template markdown.`);

  if (inputs.sellerContext) {
    parts.push(`---\n\n${inputs.sellerContext}`);
  }
  if (inputs.discoveryQuestions) {
    parts.push(`---\n\n## The founder's discovery questions\n\n${inputs.discoveryQuestions}`);
  }
  if (inputs.firstCallChecklist) {
    parts.push(`---\n\n## The founder's first-call checklist\n\n${inputs.firstCallChecklist}`);
  }
  if (!inputs.discoveryQuestions && !inputs.firstCallChecklist) {
    parts.push(`---\n\nThe founder has not authored discovery questions or a first-call checklist yet. Use a strong general-purpose B2B discovery structure (situation, pains & triggers, quantified impact, stakeholders, decision process, competition, fit, gaps) shaped by their positioning above.`);
  }
  return parts.join("\n\n");
}

/**
 * Build the prompt that FILLS a template into a per-deal Discovery
 * Summary instance from real evidence.
 */
export function buildDiscoveryInstancePrompt(inputs: {
  template: string;
  sellerContext: string; // may be ""
  evidence: string; // formatted evidence block (transcripts/timeline)
  companyName?: string;
}): string {
  return `You are filling in a founder's Discovery Summary template for a specific sales opportunity, using ONLY the evidence provided below.

Rules — follow all strictly:
- Fill every section of the template from the evidence. Replace {{COMPANY_NAME}} with "${inputs.companyName || "the prospect"}", {{DATE}} with today's date if present in the evidence header, and {{EVIDENCE_SOURCES}} with a short description of what this summary is based on (e.g. "3 call transcripts + email thread").
- EVIDENCE-GROUNDED ONLY. Every substantive claim should trace to the evidence; quote the customer's own words for pains, impact numbers, and commitments (short inline quotes). NEVER invent facts, numbers, names, or timelines.
- Where the evidence doesn't answer a section, say so plainly ("Not yet surfaced in discovery") and/or leave the template's {{PLACEHOLDER}} tokens visible — a visible gap is more useful than plausible filler.
- The "Open discovery gaps" section is critical: list the specific unanswered questions from the founder's framework, phrased ready-to-ask.
- Keep the section structure and headings of the template. Respect its guidance lines by REPLACING them with real content (do not leave the italic guidance in the output).
- Return ONLY the filled markdown document. No preamble, no commentary.

---

## TEMPLATE

${inputs.template}

${inputs.sellerContext ? `---\n\n${inputs.sellerContext}` : ""}

---

## EVIDENCE

${inputs.evidence}`;
}
