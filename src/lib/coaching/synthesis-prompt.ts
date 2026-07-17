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
EVERY explicit decision, commitment, or shift in thinking that landed during the session — be exhaustive, one bullet each. Do not drop an agreement to hit a bullet count. Phrase as resolved statements ("we'll move X to Y", "I'll stop doing Z"), not as "we discussed". If there was no real agreement on a topic, omit it rather than hedging.

## Top priorities until next session
ALL the priorities that were agreed for the coming cycle — exhaustive, never truncated to a count. If ten things were agreed as priorities, list ten. (Don't pad, either — only things actually agreed as priorities belong here.)

Structure and ranking:
- BUNDLE BY INITIATIVE: one top-level bullet per initiative (the goal or parent task the work belongs to), with its agreed subtasks nested as indented sub-bullets beneath it — never scattered as flat peers. A standalone task with no initiative is its own top-level bullet.
- RANK INITIATIVES by priority: P0 work first, then P1, then P2, then unranked. An initiative's rank is its highest-priority item. Within each initiative, rank the nested subtasks the same way (P0 → P1 → P2 → unranked).
- Show the priority tag in brackets ("[P0]") on every item that carries one — the current priorities appear in the goal/task listings in the context.
- For each item: the concrete action, the owner (default: the founder), and the success signal that says it's done. Be specific enough that a stranger reading this could pick up the work. No "continue working on X" — name the next move.

## What we'll turn to after immediate priorities
2-4 bullets naming the next layer of work that's queued up but explicitly NOT being tackled this cycle — things flagged for "after we land the top priorities". Pull from the Up Next queue and any "we'll get to X later" moments in the session. For each: what it is and the trigger / readiness signal that says it's time to pick it up (e.g. "once the first AE is hitting quota", "after the new pricing page ships"). If nothing was queued for later, write "Nothing queued — re-evaluate next session." instead of forcing bullets.

Keep individual bullets terse and scannable (one line each where possible). "What we discussed" and "What we'll turn to" stay within their bullet ranges; the agreed-items and priorities sections run as long as the session's actual agreements require — completeness beats brevity there. No preamble, no "Here's the synthesis:", no sign-off. Start with the first heading.`;
