/**
 * Synthesis prompt for coaching sessions, used by the server-side
 * auto-on-save synthesizer (lib/coaching/synthesize.ts). One copy =
 * one source of truth for what "synthesizing a session" means.
 * (The client-side manual "🧪 Synthesize Takeaways" CTA that also
 * imported this was retired once auto-synthesis shipped.)
 *
 * Standalone file (no other imports) so client bundles could import
 * it without dragging server-only modules along, should a client
 * surface need it again.
 */
export const TAKEAWAYS_SYNTHESIS_PROMPT = `Synthesize this coaching session into a terse, scannable takeaway doc with EXACTLY these four sections. Use the actual content of the session — names, deals, numbers, decisions — not generic coach-speak.

## What we discussed
3-6 bullets capturing the substantive topics, in the order they shaped the conversation. Cite specifics: which deals, which metrics, which obstacles, which questions. Skip throat-clearing and tangents.

## What we agreed
3-6 bullets of the explicit decisions, commitments, or shifts in thinking that landed during the session. Phrase as resolved statements ("we'll move X to Y", "I'll stop doing Z"), not as "we discussed". If there was no real agreement on a topic, omit it rather than hedging.

## Top priorities until next session
3-5 bullets ordered by priority. For each: the concrete action, the owner (default: the founder), and the success signal that says it's done. Be specific enough that a stranger reading this could pick up the work. No "continue working on X" — name the next move.

## What we'll turn to after immediate priorities
2-4 bullets naming the next layer of work that's queued up but explicitly NOT being tackled this cycle — things flagged for "after we land the top priorities". Pull from the Up Next queue and any "we'll get to X later" moments in the session. For each: what it is and the trigger / readiness signal that says it's time to pick it up (e.g. "once the first AE is hitting quota", "after the new pricing page ships"). If nothing was queued for later, write "Nothing queued — re-evaluate next session." instead of forcing bullets.

Keep the whole thing under ~300 words total. No preamble, no "Here's the synthesis:", no sign-off. Start with the first heading.`;
