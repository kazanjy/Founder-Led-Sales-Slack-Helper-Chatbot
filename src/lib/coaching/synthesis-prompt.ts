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
export const TAKEAWAYS_SYNTHESIS_PROMPT = `Synthesize this coaching session into a terse, scannable takeaway doc with EXACTLY these three sections. Use the actual content of the session — names, deals, numbers, decisions — not generic coach-speak.

## What we discussed
3-6 bullets capturing the substantive topics, in the order they shaped the conversation. Cite specifics: which deals, which metrics, which obstacles, which questions. Skip throat-clearing and tangents.

## Agreements & priorities until next session
EVERY explicit decision, commitment, and priority that landed during the session — exhaustive, never truncated to a count. If ten things landed, list ten. (Don't pad, either — only things that actually landed belong here.) One combined section: a commitment appears ONCE, with its owner and done-signal — never restated in two places.

Structure and ranking:
- BUNDLE BY INITIATIVE: one top-level bullet per initiative (the goal or body of work — use the goal/task listings in the context to match), everything belonging to it nested beneath. Items that belong to no initiative get their own top-level bullet.
- RANK INITIATIVES by priority: P0 first, then P1, P2, unranked. An initiative's rank is its highest-priority item. Show priority tags in brackets ("[P0]") wherever the work carries one.
- Within each initiative, two kinds of nested bullets:
  - DECISIONS — resolved statements that set direction but aren't actions ("we'll count POC-scoping as trial starts", "we won't hire for Founding Agent yet"). Phrase as resolved ("we'll move X to Y"), never "we discussed". Lead with these, most load-bearing first.
  - ACTIONS — the work for the coming cycle, ranked by priority within the initiative (P0 → P1 → P2 → unranked). Each: the concrete action, the owner (default: the founder), and the done-signal ("done when …"). Specific enough that a stranger could pick up the work. No "continue working on X" — name the next move.

## What we'll turn to after immediate priorities
2-4 bullets naming the next layer of work that's queued up but explicitly NOT being tackled this cycle — things flagged for "after we land the top priorities". Pull from the Up Next queue and any "we'll get to X later" moments in the session. For each: what it is and the trigger / readiness signal that says it's time to pick it up (e.g. "once the first AE is hitting quota", "after the new pricing page ships"). If nothing was queued for later, write "Nothing queued — re-evaluate next session." instead of forcing bullets.

Keep individual bullets terse and scannable (one line each where possible). "What we discussed" and "What we'll turn to" stay within their bullet ranges; the combined agreements-and-priorities section runs as long as the session's actual agreements require — completeness beats brevity there. No preamble, no "Here's the synthesis:", no sign-off. Start with the first heading.`;
