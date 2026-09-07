/**
 * Output contract for the Coaching page's "What Next?" recommendations.
 *
 * Used by the Coaching page's "What Next?". GTM Readiness asks a
 * similar question over similar context and could adopt this in one
 * line, but has not been changed — it still asks for rationale in its
 * own words.
 *
 * The contract exists because "explain why it matters" was too weak an
 * instruction. It produced generic rationale ("improving discovery will
 * increase conversion") that would read the same for any company, and
 * it arrived AFTER the recommendation, where it functions as
 * justification rather than reasoning. Leading with the trigger and the
 * evidence forces the recommendation to come out of the founder's
 * actual history, and makes a recommendation that ISN'T grounded
 * obvious on sight — there is nowhere to put the citation.
 *
 * The anti-fabrication rule is the load-bearing half. A cited session
 * date or readiness item is checkable; an invented one is worse than no
 * recommendation at all, because it looks like the model read something
 * the founder has forgotten.
 */
export const WHAT_NEXT_OUTPUT_CONTRACT = `## How to write each recommendation

Every recommendation MUST open with why it is being made and what in the
context above justifies it, before it says what to do. Use exactly this
structure, in this order:

### <Short action title>

**Why now:** The specific situation that makes this the next thing to do —
not why the topic matters in general. "Discovery is important" is not a
reason; "three of your last four calls ended without a scheduled next
step" is.

**Evidence:** What in the context above supports this. Cite it specifically
and attributably:
- Coaching sessions by DATE and what was said or decided in them
- Readiness items by their exact TITLE and current status
- Goals and tasks by TITLE, including how long they have been open or
  stalled
- Metrics by name and value, including the direction they have moved
Quote or closely paraphrase. Two or three citations is usually right; one
is acceptable when it is decisive.

**What to do:** The concrete action, specific enough to start this week.

**How you'll know it worked:** The observable change that would tell you
this was the right call.

## Grounding rules

- NEVER invent evidence. Every date, title, number and quote must come
  from the context above. A fabricated citation is worse than no
  recommendation, because it looks like something the founder has
  forgotten.
- If you believe something is the right next move but the context does not
  support it, you may still recommend it — but say plainly under
  **Evidence** that this is your judgement rather than something the
  history shows, and explain what you are inferring from.
- If the context is too thin to recommend anything specific, say so and
  name what you would need. Do not pad the list to reach a count.
- Prefer recommendations the evidence makes unavoidable over
  recommendations that are merely sensible.`;
