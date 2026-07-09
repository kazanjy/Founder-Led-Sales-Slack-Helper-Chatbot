import { openai } from "@/lib/openai";
import type { PracticePersona } from "./persona";

/**
 * Practice grading engine. One uniform score shape across all drills
 * so a single report-card component renders every one of them.
 */

export interface PracticeScoreDimension {
  name: string;
  score: number;
  max: number;
  comment: string;
}

export interface PracticeScore {
  overall: string; // letter grade: "A" | "A-" | "B+" | ... | "F"
  dimensions: PracticeScoreDimension[];
  modelAnswer: string; // what great looks like, concretely
  nextRep: string; // the ONE thing to fix on the next attempt
  /** Ick flags (rapport drill): named fouls like "fake flattery". */
  flags?: string[];
  /** Alternative approaches the founder could have taken. */
  alternatives?: string[];
}

export interface PrecallAnswers {
  orgPersona: string;
  humanPersona: string;
  angle: string;
  valuePropsLand: string[];
}

const PRECALL_GRADING_PROMPT = `You are grading a founder's PRE-CALL PLANNING drill attempt. They were shown only the PUBLIC card of a synthetic buyer and had to plan their approach. You have the full persona (public card + hidden dossier) and their answers.

Grade these four dimensions, each 0-5:

1. "Org persona ID" — did they identify the right organizational persona? Exact-option match scores 5; a near-miss (adjacent segment, defensible from the card) scores 2-3; clearly wrong scores 0-1.
2. "Human persona ID" — same scale for the person's role in the deal.
3. "Angle / pain hypothesis" — does their free-text angle name the buyer's actual pains and why-now? Grade on substance: specific correct pains score high even if phrased differently than the dossier; generic "they want efficiency" mush scores low; a wrong-but-well-reasoned-from-the-card hypothesis scores mid.
4. "Value-prop mapping" — they selected which value props LAND for this buyer. Score = accuracy in BOTH directions: credit for each correctly selected landing prop and each correctly omitted non-landing prop; deduct for each miss. Selecting a prop the buyer doesn't care about is as costly as missing one they do — pitching it on a real call burns time and credibility.

FAIRNESS: only penalize what was inferable from the public card. If the dossier contains something the card genuinely didn't signal, note it in the comment but don't dock points for missing it.

Return ONLY a JSON object:
{
  "overall": "<letter grade A/A-/B+/B/B-/C+/C/D/F — weight the four dimensions equally>",
  "dimensions": [
    { "name": "Org persona ID", "score": 0-5, "max": 5, "comment": "<1-2 sentences, specific>" },
    { "name": "Human persona ID", "score": 0-5, "max": 5, "comment": "..." },
    { "name": "Angle / pain hypothesis", "score": 0-5, "max": 5, "comment": "..." },
    { "name": "Value-prop mapping", "score": 0-5, "max": 5, "comment": "<name the specific props they got right/wrong>" }
  ],
  "modelAnswer": "<4-6 sentences: the ideal plan for this exact buyer — the persona call, the angle you'd open with, which props to lead with and which to keep holstered. Concrete, second person ('lead with…'), grounded in the card's signals.>",
  "nextRep": "<ONE sentence: the single highest-leverage thing to do differently next attempt>"
}`;

// The rapport philosophy, shared verbatim between the grader, the
// hint generator, the persona-reply generator, and the pre-attempt
// guidance shown in the UI — one definition of what good looks like.
export const RAPPORT_PHILOSOPHY = `Rapport is about making the other person feel COMFORTABLE and AT EASE before business starts — warmth, lightness, ideally a laugh. The best icebreakers pick up a PERSONAL thread (a hobby, a joke they made, a shared human experience), engage with it like a fellow human, and END WITH AN EASY QUESTION — then WAIT. The buyer responds, and only THEN do you pivot to business, riding whatever they said. Business topics — their company's posts, panels, initiatives — are pre-call research material, NOT rapport: opening on work signals "I'm here to extract value," keeps their guard up, and skips the whole point. Personal, warm, and brief beats clever and professional every time.`;

const RAPPORT_GRADING_PROMPT = `You are grading a founder's RAPPORT drill attempt — a TWO-TURN exchange. They were shown a synthetic buyer's public card (bio + rapport breadcrumbs), delivered an ICEBREAKER (turn 1), the buyer RESPONDED in character, and the founder then delivered their PIVOT to business (turn 2). Inputs are voice-transcribed or typed; ignore transcription artifacts like missing punctuation.

THE PHILOSOPHY YOU ARE GRADING AGAINST:
${RAPPORT_PHILOSOPHY}

Grade these five dimensions, each 0-5:

1. "Warmth & humor" (icebreaker) — does it create ease? Lightness, playfulness, a genuine human moment that would make the buyer smile or relax? Stiff professional politeness scores 1-2 even when flawless.
2. "Personal connection" (icebreaker) — did they pick a PERSONAL breadcrumb (hobby, humor, life detail, shared experience) and engage with it genuinely? Business-content breadcrumbs (posts, panels, company initiatives) score 0-2 on this dimension — that's research material, not rapport. Alma mater is mid: only strong with a genuine angle, and turning it into a quiz question is a foul. No breadcrumb at all scores 1.
3. "Invites a response" (icebreaker) — does it end with an easy, open, personal question and hand the mic over? A statement that leaves the buyer nowhere to go, a closed yes/no dead-end, or a question buried mid-ramble scores low. Brevity folds in here: 1-3 sentences ending in the question is right; a monologue before the question caps this at 2.
4. "Reading the response" (pivot) — does the pivot actually ACKNOWLEDGE what the buyer just said? A genuine beat of reaction (laugh, callback, one-line follow-on) before transitioning scores high. Ignoring her answer and bulldozing into the agenda scores 0-1.
5. "The pivot" (pivot) — after the human beat, does it transition into business gracefully and briefly ("anyway — I know we've only got 30 minutes, I'd love to…")? The handoff should feel like a comma, not a gear change; stranding the call in small talk with no transition also scores low.

ICK FLAGS — list any that apply (empty list if clean): "business-topic opener", "fake flattery", "over-familiarity", "creepy-specific research", "self-centered opener", "interview-question opener", "apology opener", "ignored their response". Each flag present should also depress the relevant dimension score.

FAIRNESS: grade only against the card they saw and the exchange as it happened. Do not invent context.

Return ONLY a JSON object:
{
  "overall": "<letter grade A/A-/B+/B/B-/C+/C/D/F>",
  "dimensions": [
    { "name": "Warmth & humor", "score": 0-5, "max": 5, "comment": "..." },
    { "name": "Personal connection", "score": 0-5, "max": 5, "comment": "<name the breadcrumb they used and whether it was a personal or business thread>" },
    { "name": "Invites a response", "score": 0-5, "max": 5, "comment": "<include the word count>" },
    { "name": "Reading the response", "score": 0-5, "max": 5, "comment": "..." },
    { "name": "The pivot", "score": 0-5, "max": 5, "comment": "..." }
  ],
  "flags": ["<ick flags, or empty array>"],
  "modelAnswer": "<the full exchange YOU would run with this exact buyer: your icebreaker (personal thread, warm, ends in a question), then — given what she actually replied — your pivot. Written verbatim, first person.>",
  "alternatives": ["<a second icebreaker taking a DIFFERENT personal thread, verbatim>", "<a third, different again>"],
  "nextRep": "<ONE sentence: the single highest-leverage fix for next attempt>"
}`;

/**
 * Grade a rapport exchange: icebreaker → persona response → pivot.
 */
export async function gradeRapport(
  persona: PracticePersona,
  exchange: { icebreaker: string; personaReply: string; pivot: string }
): Promise<PracticeScore> {
  const payload = {
    persona: { public: persona.public, hidden: persona.hidden },
    exchange,
  };
  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: `${RAPPORT_GRADING_PROMPT}\n\n---\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });
  let parsed: Partial<PracticeScore>;
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("Grader returned unparseable JSON");
  }
  if (!parsed.overall || !Array.isArray(parsed.dimensions) || parsed.dimensions.length === 0) {
    throw new Error("Grader returned an incomplete score");
  }
  return {
    overall: parsed.overall,
    dimensions: parsed.dimensions.map((d) => ({
      name: String(d.name || "Dimension"),
      score: typeof d.score === "number" ? d.score : 0,
      max: typeof d.max === "number" ? d.max : 5,
      comment: String(d.comment || ""),
    })),
    flags: Array.isArray(parsed.flags)
      ? parsed.flags.filter((f): f is string => typeof f === "string")
      : [],
    alternatives: Array.isArray(parsed.alternatives)
      ? parsed.alternatives.filter((a): a is string => typeof a === "string")
      : [],
    modelAnswer: String(parsed.modelAnswer || ""),
    nextRep: String(parsed.nextRep || ""),
  };
}

const AGENDA_GRADING_PROMPT = `You are grading a founder's AGENDA-SETTING drill attempt. They practiced delivering their agenda-set + elevator-pitch script out loud (or typed it). You have their SCRIPT (as they approved it before starting), their delivered TRANSCRIPT (voice-transcribed — ignore punctuation artifacts, but filler words in the transcript are REAL and gradeable), the MODE (script_visible = teleprompter on screen; script_hidden = from memory), and the measured DURATION in seconds (null when typed).

Grade these four dimensions, each 0-5:

1. "Beat coverage" — did they hit the script's beats IN ORDER? The load-bearing beats: respect for time; the shape of the call (learn about them first); the INTEGRATED context pitch ("and just to provide some context, <solution> <who/outcome/proof>") delivered inside the agenda flow, not bolted on; the explicit out ("if it's not relevant, useful to know"); and the closing up-front contract confirmation + call for agreement/additions ("does that work — anything else you want to cover?"). Missing that closing confirmation caps this at 3 — it's the beat that makes an agenda collaborative instead of imposed.
2. "Fidelity vs. riffing" — paraphrase is FINE and natural; grade whether the load-bearing phrasings survived (the value-prop language, the explicit out) and whether any ad-libs helped or hurt. In script_hidden mode, grade this more generously — reconstruction beats recitation.
3. "Time discipline" — target: agenda set + pitch under ~90 seconds total. With DURATION: under 90s = 5; 90-120s = 3-4; over 120s = 0-2. Without duration (typed), estimate from word count at ~150 wpm and say so in the comment.
4. "Delivery" — from the transcript: filler density ("um", "uh", "like", "you know", "sort of", "kind of" per minute — count them), sentence completion (trailing off mid-thought), and pace if duration is available (words/min; 130-170 is conversational, 200+ is rushed). Quote the worst filler cluster if there is one.

ICK FLAGS — list any that apply (empty if clean): "filler storm", "monologue pace", "skipped the check-for-agreement", "buried the pitch", "apologetic framing".

Return ONLY a JSON object:
{
  "overall": "<letter grade A/A-/B+/B/B-/C+/C/D/F — in script_hidden mode, add leniency on fidelity but not on beats or delivery>",
  "dimensions": [
    { "name": "Beat coverage", "score": 0-5, "max": 5, "comment": "<name the beats hit and missed, in order>" },
    { "name": "Fidelity vs. riffing", "score": 0-5, "max": 5, "comment": "..." },
    { "name": "Time discipline", "score": 0-5, "max": 5, "comment": "<include the duration or word-count estimate>" },
    { "name": "Delivery", "score": 0-5, "max": 5, "comment": "<include filler count and pace>" }
  ],
  "flags": ["<ick flags, or empty array>"],
  "modelAnswer": "<2-4 sentences: the specific delivery adjustments that would take THIS attempt to an A — not a rewrite of the script>",
  "nextRep": "<ONE sentence: the single highest-leverage fix for next attempt>"
}`;

/**
 * Grade an agenda-setting delivery against the approved script.
 */
export async function gradeAgendaSet(
  attempt: {
    script: string;
    transcript: string;
    durationMs: number | null;
    mode: "script_visible" | "script_hidden";
  }
): Promise<PracticeScore> {
  const payload = {
    mode: attempt.mode,
    durationSeconds: attempt.durationMs !== null ? Math.round(attempt.durationMs / 1000) : null,
    script: attempt.script,
    transcript: attempt.transcript,
  };
  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: `${AGENDA_GRADING_PROMPT}\n\n---\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });
  let parsed: Partial<PracticeScore>;
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("Grader returned unparseable JSON");
  }
  if (!parsed.overall || !Array.isArray(parsed.dimensions) || parsed.dimensions.length === 0) {
    throw new Error("Grader returned an incomplete score");
  }
  return {
    overall: parsed.overall,
    dimensions: parsed.dimensions.map((d) => ({
      name: String(d.name || "Dimension"),
      score: typeof d.score === "number" ? d.score : 0,
      max: typeof d.max === "number" ? d.max : 5,
      comment: String(d.comment || ""),
    })),
    flags: Array.isArray(parsed.flags)
      ? parsed.flags.filter((f): f is string => typeof f === "string")
      : [],
    modelAnswer: String(parsed.modelAnswer || ""),
    nextRep: String(parsed.nextRep || ""),
  };
}

/**
 * Grade a pre-call planning attempt. Returns the uniform score shape;
 * throws on model failure (caller surfaces the error, session stays
 * active so the founder can retry grading).
 */
export async function gradePrecallPlan(
  persona: PracticePersona,
  answers: PrecallAnswers
): Promise<PracticeScore> {
  const payload = {
    persona: { public: persona.public, hidden: persona.hidden },
    quizOptions: persona.quiz,
    founderAnswers: answers,
  };

  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: `${PRECALL_GRADING_PROMPT}\n\n---\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  let parsed: Partial<PracticeScore>;
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("Grader returned unparseable JSON");
  }
  if (!parsed.overall || !Array.isArray(parsed.dimensions) || parsed.dimensions.length === 0) {
    throw new Error("Grader returned an incomplete score");
  }

  return {
    overall: parsed.overall,
    dimensions: parsed.dimensions.map((d) => ({
      name: String(d.name || "Dimension"),
      score: typeof d.score === "number" ? d.score : 0,
      max: typeof d.max === "number" ? d.max : 5,
      comment: String(d.comment || ""),
    })),
    modelAnswer: String(parsed.modelAnswer || ""),
    nextRep: String(parsed.nextRep || ""),
  };
}
