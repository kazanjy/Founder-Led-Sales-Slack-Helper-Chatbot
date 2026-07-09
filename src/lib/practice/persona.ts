import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { loadSellerContext, formatSellerContext } from "@/lib/seller-context";
import { loadDiscoveryFramework } from "@/lib/discovery-framework";

/**
 * Practice-suite persona synthesizer (see practice-suite-plan.md).
 *
 * Generates a synthetic buyer as a TWO-LAYER card:
 *  - `public`: what the founder sees before answering — name, title,
 *    company snapshot, LinkedIn-ish bio with planted breadcrumbs.
 *  - `hidden`: the dossier the grader uses — true org/human persona,
 *    pains, compelling event, which value props land / don't,
 *    temperament, objections. NEVER sent to the client until the
 *    session is graded (the API strips it).
 *  - `quiz`: the option lists the drill form renders (org/human
 *    persona choices incl. the correct one + plausible distractors,
 *    and the shuffled value-prop list).
 *
 * FAIRNESS RULE (enforced in the prompt): everything in `hidden` must
 * be inferable from `public` — the public card has to carry the
 * signals (industry, size, title, bio breadcrumbs) that let a sharp
 * founder deduce the persona and probable pains. No gotchas.
 */

export interface PracticePersonaPublic {
  name: string;
  title: string;
  company: {
    name: string;
    industry: string;
    size: string;
    blurb: string;
  };
  bio: string;
  breadcrumbs: string[];
}

export interface PracticePersonaHidden {
  orgPersona: string;
  humanPersona: string;
  pains: string[];
  currentState: string;
  compellingEvent: string;
  valuePropsThatLand: string[];
  valuePropsThatDont: string[];
  temperament: string;
  objections: string[];
}

export interface PracticePersonaQuiz {
  orgPersonaOptions: string[];
  humanPersonaOptions: string[];
  valueProps: string[]; // shuffled union of land + don't-land
}

export interface PracticePersona {
  public: PracticePersonaPublic;
  hidden: PracticePersonaHidden;
  quiz: PracticePersonaQuiz;
  /** Agenda drill: the script this scenario practices against
   *  (snapshotted at creation; session-local edits update it). */
  script?: string;
  scriptSource?: "saved_default" | "generated" | "fallback";
}

const SYNTH_PROMPT = `You are building a SYNTHETIC buyer persona for a founder's sales-practice drill. Using the founder's playbook below (positioning, ICP, discovery framework), invent ONE realistic prospect they might meet next week.

Return ONLY a JSON object with this exact shape:

{
  "public": {
    "name": "<invented full name — must not be a real notable person>",
    "title": "<their job title>",
    "company": { "name": "<invented company>", "industry": "...", "size": "<e.g. '~140 employees, Series B'>", "blurb": "<2-3 sentence company description>" },
    "bio": "<3-4 sentence LinkedIn-style bio>",
    "breadcrumbs": ["<3-5 rapport-surface details: a recent post topic, alma mater, a talk they gave, a hobby hint, a shared-context hook>"]
  },
  "hidden": {
    "orgPersona": "<which of the founder's org personas this company truly is — use the ICP's own language>",
    "humanPersona": "<which human persona this person is: economic buyer / champion / end user / technical evaluator / etc., phrased per the founder's ICP where possible>",
    "pains": ["<3-5 specific pains this buyer has that the founder's product addresses>"],
    "currentState": "<how they handle the problem today>",
    "compellingEvent": "<the why-now trigger>",
    "valuePropsThatLand": ["<2-4 of the founder's value props THIS buyer cares about, phrased short>"],
    "valuePropsThatDont": ["<2-3 of the founder's value props this buyer does NOT care about, phrased short — real props from the playbook, just mismatched to this persona>"],
    "temperament": "<one of: chatty | guarded | skeptical | distracted | enthusiastic>",
    "objections": ["<2-3 objections this buyer would raise>"]
  },
  "quiz": {
    "orgPersonaOptions": ["<4-5 org-persona choices in the ICP's language — MUST include hidden.orgPersona verbatim; distractors must be plausible-but-wrong>"],
    "humanPersonaOptions": ["<4-5 human-persona choices — MUST include hidden.humanPersona verbatim>"]
  }
}

Rules:
- FAIRNESS: every hidden fact must be inferable from the public card. The company blurb/size/industry must signal the org persona; the title/bio must signal the human persona; the breadcrumbs and blurb should hint at the pains. A sharp founder reading only the public card should be able to score well.
- Value props (both lists) must be REAL propositions from the founder's playbook below — short paraphrases are fine, inventions are not. The two lists must not overlap.
- Vary difficulty naturally: sometimes the persona is a textbook fit, sometimes an edge case (e.g. right company, wrong role).
- Invented names/companies only. No real people, no real customer names from the playbook.
- Return ONLY the JSON object.`;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generate a synthetic practice persona from the founder's playbook.
 * Throws when the playbook is too thin to ground a persona (no
 * narrative AND no ICP) — the drill needs something to grade against.
 */
export async function synthesizePersona(userId: string): Promise<PracticePersona> {
  const [seller, framework, icpVersion] = await Promise.all([
    loadSellerContext(userId),
    loadDiscoveryFramework(userId),
    prisma.icpVersion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    }),
  ]);

  let icpText = "";
  if (icpVersion) {
    try {
      const parsed = JSON.parse(icpVersion.content) as {
        sections?: Array<{ name?: string; items?: string[] }>;
      };
      const parts: string[] = [];
      for (const s of parsed.sections || []) {
        if (!s.items?.length) continue;
        parts.push(`### ${s.name}\n${s.items.map((i) => `- ${i}`).join("\n")}`);
      }
      icpText = parts.join("\n\n");
    } catch {
      /* malformed — proceed without ICP */
    }
  }

  if (!seller.narrative && !icpText) {
    throw new Error(
      "Practice needs a sales narrative or ICP to build personas from — create one of those first."
    );
  }

  const contextParts: string[] = [];
  const sellerBlock = formatSellerContext(seller);
  if (sellerBlock) contextParts.push(sellerBlock);
  if (icpText) contextParts.push(`## Ideal Customer Profile\n\n${icpText}`);
  if (framework.questionsListing) {
    contextParts.push(`## Discovery questions (for pain grounding)\n\n${framework.questionsListing}`);
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: `${SYNTH_PROMPT}\n\n---\n\n${contextParts.join("\n\n---\n\n").substring(0, 60_000)}`,
      },
    ],
  });

  let parsed: {
    public?: PracticePersonaPublic;
    hidden?: PracticePersonaHidden;
    quiz?: { orgPersonaOptions?: string[]; humanPersonaOptions?: string[] };
  };
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("Persona generation returned unparseable JSON");
  }
  const pub = parsed.public;
  const hidden = parsed.hidden;
  if (!pub?.name || !pub?.company?.name || !hidden?.orgPersona || !hidden?.humanPersona) {
    throw new Error("Persona generation returned an incomplete card");
  }

  // Assemble quiz lists server-side: guarantee the correct answers are
  // present even if the model forgot its own rule, then shuffle so
  // position carries no signal.
  const orgOptions = new Set(parsed.quiz?.orgPersonaOptions || []);
  orgOptions.add(hidden.orgPersona);
  const humanOptions = new Set(parsed.quiz?.humanPersonaOptions || []);
  humanOptions.add(hidden.humanPersona);
  const valueProps = shuffle([
    ...(hidden.valuePropsThatLand || []),
    ...(hidden.valuePropsThatDont || []),
  ]);

  return {
    public: pub,
    hidden,
    quiz: {
      orgPersonaOptions: shuffle([...orgOptions]),
      humanPersonaOptions: shuffle([...humanOptions]),
      valueProps,
    },
  };
}
