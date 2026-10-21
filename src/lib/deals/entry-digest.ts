/**
 * One-time digests for call transcripts.
 *
 * The deal analyzer used to re-send every transcript in full on every
 * run. An hour-long call is ~100K chars, a deal carries several, and a
 * deal analyzed ten times paid for all of them ten times — to re-derive
 * conclusions already written down in its previous analysis.
 *
 * A transcript's content never changes, so it only ever needs reading
 * once. The digest is written here and the analyzer reads it instead.
 *
 * Deliberately a BACKGROUND SWEEP rather than something the analyzer
 * triggers inline. Digesting on demand would put N model calls in front
 * of an analysis that already runs 30-60s, on a cron with a 300s
 * ceiling, and the first run after deploy would stall on the whole
 * backlog. Here the backlog drains a few entries per tick and the
 * analyzer treats a missing digest as a normal case.
 */

import { prisma } from "@/lib/db";
import { openai } from "@/lib/openai";

/** Entry types whose bodies are long enough to be worth digesting. */
const DIGESTIBLE_TYPES = ["call_transcript", "call_summary"];

/**
 * Below this, the raw content is already digest-sized and compressing
 * it would cost a model call to save nothing.
 */
const MIN_CHARS_TO_DIGEST = 12_000;

/**
 * Per-tick cap. The sweep runs every 5 minutes, so a backlog of a few
 * hundred transcripts clears within a day without any single tick
 * spending real money or time.
 */
const DEFAULT_SWEEP_LIMIT = 3;

/**
 * Full-fidelity model, on purpose.
 *
 * This runs ONCE per transcript and its output replaces that transcript
 * as the analyzer's evidence forever after. A cheap model here would
 * save a few cents once and degrade every future analysis of the deal.
 * The economics run the other way: one digest costs roughly what it
 * saves on the very next re-analysis.
 */
const DIGEST_MODEL = "gpt-5.5";

const DIGEST_SYSTEM_PROMPT = `You are compressing a sales call transcript into a dense factual digest that a deal analyst will later read INSTEAD OF the transcript. Everything you omit is lost to them.

Preserve, in this order:

## Participants & Roles
Who spoke, their apparent role, and who holds budget or decision authority — only where the transcript supports it.

## What the Buyer Said
Their stated pain, current workflow, what they are using today, and the words they used for it. Quote verbatim where a phrase is distinctive — exact wording is evidence a later reader cannot reconstruct.

## Numbers & Facts
Every figure mentioned: team sizes, volumes, budgets, timelines, contract dates, pricing discussed, current spend. Never round or approximate. These are the hardest things to recover and the most useful.

## Objections & Risks
Concerns raised, hesitation, competing options named, anything that sounded like a blocker.

## Commitments
What each side agreed to do, by when, and any next meeting discussed.

## Open Questions
What was raised but left unresolved.

Rules:
- Facts only. Never infer, never add strategic advice, never editorialize — the analyst does that.
- If a section has nothing in the transcript, write "None stated." Do not invent content to fill it.
- Dense notes, not prose. No preamble, no closing summary.
- Aim for 400-900 words. A sparse call should produce a short digest.`;

/** Build a digest for one entry's content. Throws on API failure. */
export async function digestContent(content: string, title?: string | null): Promise<string> {
  const response = await openai.chat.completions.create({
    model: DIGEST_MODEL,
    messages: [
      { role: "system", content: DIGEST_SYSTEM_PROMPT },
      {
        role: "user",
        content: `${title ? `Call: ${title}\n\n` : ""}Transcript:\n\n${content}`,
      },
    ],
  });
  const digest = response.choices[0]?.message?.content?.trim() || "";
  if (!digest) throw new Error("Digest model returned no content");
  return digest;
}

export interface DigestSweepResult {
  digested: number;
  failed: number;
}

/**
 * Digest a few not-yet-digested call entries.
 *
 * Oldest first: the old entries are exactly the ones a re-analysis
 * would otherwise re-send in full, so they repay the cost soonest.
 *
 * Never throws — a digest failure must not take down the cron tick it
 * runs in. A failed entry simply stays undigested and is retried on a
 * later tick.
 */
export async function sweepEntryDigests(
  limit = DEFAULT_SWEEP_LIMIT
): Promise<DigestSweepResult> {
  let digested = 0;
  let failed = 0;

  try {
    const pending = await prisma.dealTimelineEntry.findMany({
      where: {
        type: { in: DIGESTIBLE_TYPES },
        digestedAt: null,
      },
      orderBy: { entryDate: "asc" },
      take: limit,
      select: { id: true, title: true, content: true },
    });

    for (const entry of pending) {
      // Short entries are marked digested with a null digest so the
      // sweep doesn't keep rediscovering them every five minutes. The
      // analyzer sends these verbatim regardless — they're already
      // small.
      if (entry.content.length < MIN_CHARS_TO_DIGEST) {
        await prisma.dealTimelineEntry.update({
          where: { id: entry.id },
          data: { digestedAt: new Date() },
        });
        continue;
      }

      try {
        const digest = await digestContent(entry.content, entry.title);
        await prisma.dealTimelineEntry.update({
          where: { id: entry.id },
          data: { digest, digestedAt: new Date() },
        });
        digested++;
        console.log(
          `[entry-digest] entry=${entry.id} ${entry.content.length} chars -> ${digest.length} chars`
        );
      } catch (err) {
        failed++;
        // Left undigested on purpose: a transient API failure should
        // be retried, not permanently recorded as "done".
        console.error(`[entry-digest] failed for entry=${entry.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[entry-digest] sweep failed:", err);
  }

  return { digested, failed };
}
