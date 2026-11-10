/**
 * Export the discovery-call scoring rubric as markdown.
 *
 *   npx tsx scripts/export-discovery-rubric.ts > discovery-call-scoring-rubric.md
 *
 * Generated from src/lib/call-review/rubric.ts rather than written by
 * hand, so the document cannot drift from the rubric the reviewer
 * actually scores against. Re-run it after changing the rubric.
 *
 * This is the RUBRIC alone. discovery-call-review-prompt.md is the full
 * prompt the model receives, which embeds this plus the instructions
 * and output contract — useful for a different question.
 */

import { DISCOVERY_CALL_RUBRIC } from "../src/lib/call-review/rubric";

const out: string[] = [];
const rubric = DISCOVERY_CALL_RUBRIC;
const max = rubric.sections.reduce((sum, s) => sum + s.maxScore, 0);
const itemCount = rubric.sections.reduce((n, s) => n + s.items.length, 0);

out.push("# Discovery Call Scoring Rubric");
out.push("");
out.push(
  `*Generated from \`src/lib/call-review/rubric.ts\` on ${new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}. Re-run \`npx tsx scripts/export-discovery-rubric.ts\` after changing the rubric.*`
);
out.push("");
out.push(
  `**${itemCount} items across ${rubric.sections.length} sections. ${max} points total.** ` +
    "Every item is scored 0, 1 or 2 — missed, partial, nailed — and the overall score is their plain sum. " +
    "There is no weighting beyond the number of items a section contains, so a section's weight IS its item count."
);
out.push("");

// Weight table first: it is the fastest way to see what the rubric
// actually cares about, which is not obvious from reading it in order.
out.push("## Section weights");
out.push("");
out.push("| Section | Items | Max points | Share |");
out.push("| --- | ---: | ---: | ---: |");
for (const s of rubric.sections) {
  const share = Math.round((s.maxScore / max) * 100);
  out.push(`| ${s.label} | ${s.items.length} | ${s.maxScore} | ${share}% |`);
}
out.push(`| **Total** | **${itemCount}** | **${max}** | **100%** |`);
out.push("");

for (const section of rubric.sections) {
  out.push(`## ${section.label}`);
  out.push("");
  out.push(`*Max ${section.maxScore} points across ${section.items.length} items.*`);
  out.push("");
  for (const item of section.items) {
    out.push(`### ${item.label}`);
    out.push("");
    out.push("| Score | Means |");
    out.push("| :---: | --- |");
    out.push(`| **0** | ${item.scoringGuide["0"]} |`);
    out.push(`| **1** | ${item.scoringGuide["1"]} |`);
    out.push(`| **2** | ${item.scoringGuide["2"]} |`);
    out.push("");
  }
}

out.push("## Red flags");
out.push("");
out.push(
  "Noted separately from the score. These are call-level failures rather than item-level misses, " +
    "so a call can score respectably and still carry one."
);
out.push("");
out.push("| Red flag | How it's detected |");
out.push("| --- | --- |");
for (const f of rubric.redFlags) {
  out.push(`| ${f.label} | ${f.detection} |`);
}
out.push("");

out.push("## How the score is computed");
out.push("");
out.push(
  "`calculateOverallScore()` sums every item score and every section max. Two consequences worth knowing:"
);
out.push("");
out.push(
  "- **An unscored item counts as zero, not as excluded.** The denominator is the full " +
    `${max} regardless of how many items the reviewer actually returned, so a partial review reads as a low score rather than a short one.`
);
out.push(
  "- **Red flags do not subtract.** They are reported alongside the score, not deducted from it."
);
out.push("");

console.log(out.join("\n"));
