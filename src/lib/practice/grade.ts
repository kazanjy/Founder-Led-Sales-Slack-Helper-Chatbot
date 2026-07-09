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
