/**
 * "This message is about a candidate" detection, shared by every
 * router in the cascade.
 *
 * Candidate screening lives on the GTM agent (assessCandidateProfile),
 * which is the LAST router in the chain — so both routers ahead of it
 * have to actively decline, or the message never reaches the tool that
 * can answer it. The deal router has declined since it was written; the
 * coaching router did not, and "AE profile review: linkedin.com/in/…"
 * was being answered by the coaching agent, which improvised "I can't
 * open LinkedIn URLs from here" while the real tool sat one router
 * further down.
 *
 * A `linkedin.com/in/` URL is decisive on its own. Everything else
 * takes an explicit hiring word, because candidates' employers are very
 * often the founder's own prospects.
 */

const HIRING_TRIGGERS: RegExp[] = [
  /linkedin\.com\/in\//i,
  /\bcandidate\b/i,
  /\br[ée]sum[ée]\b|\bresume\b|\bcv\b/i,
  /\bhiring\b|\bhire\b|\binterview(ing)?\b/i,
  /\bapplicant\b|\brecruit(ing|er)?\b/i,
  /\bae profile\b|\bprofile review\b/i,
];

export function hasHiringSignal(text: string): boolean {
  return HIRING_TRIGGERS.some((re) => re.test(text));
}
