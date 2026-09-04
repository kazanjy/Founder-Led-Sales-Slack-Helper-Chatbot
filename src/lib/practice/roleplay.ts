import { openai } from "@/lib/openai";
import { RAPPORT_PHILOSOPHY } from "./grade";
import type { PracticePersona } from "./persona";

/**
 * In-character persona replies for roleplay drills. The buyer answers
 * from the HIDDEN dossier (temperament shapes cooperativeness) but,
 * like a real buyer, gives away only what the founder's turn earned.
 * Replies are deliberately SHORT — real buyers don't monologue.
 */
export async function generatePersonaReply(
  persona: PracticePersona,
  context: "rapport_icebreaker",
  founderText: string
): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    messages: [
      {
        role: "user",
        content: `You are roleplaying ${persona.public.name}, ${persona.public.title} at ${persona.public.company.name}, on the first seconds of a sales call. Your character (public card + private disposition):

${JSON.stringify({ public: persona.public, temperament: persona.hidden.temperament }, null, 2)}

The founder just opened the call with this icebreaker:
"${founderText}"

Reply IN CHARACTER as ${persona.public.name} — how this person would actually respond in the moment. Rules:
- 1-3 sentences, spoken-out-loud natural. Real buyers are brief.
- Let your temperament ("${persona.hidden.temperament}") shape the energy: a chatty buyer plays along warmly; a guarded or skeptical one stays polite but cooler.
- React honestly to the QUALITY of the opener. A warm personal opener that references something true about you earns a genuine, human response (share a small detail, maybe humor back). A business-y, awkward, over-familiar, or interview-style opener gets a polite but flatter response — the way real people deflect.
- Do NOT volunteer business pains or company information — this is small talk. (Context: ${RAPPORT_PHILOSOPHY.split(".")[0]}.)
- Return ONLY the spoken reply, no quotes, no stage directions.`,
      },
    ],
  });
  const reply = (completion.choices[0]?.message?.content || "").trim();
  if (!reply) throw new Error("Persona reply generation returned empty");
  return reply;
}

/**
 * Discovery roleplay reply: the buyer answers a discovery question in
 * character. The core mechanic — information is EARNED: a sharp, open
 * question that hits a real pain gets substance (with numbers if the
 * dossier has them); a weak, closed, or off-target question gets a
 * true-but-thin answer. Gold threads get dangled, not dumped.
 */
export async function generateDiscoveryReply(
  persona: PracticePersona,
  priorTurns: Array<{ role: string; text: string }>,
  founderText: string
): Promise<string> {
  const transcript = priorTurns
    .map((t) => `${t.role === "user" ? "FOUNDER" : persona.public.name.toUpperCase()}: ${t.text}`)
    .join("\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    messages: [
      {
        role: "user",
        content: `You are roleplaying ${persona.public.name}, ${persona.public.title} at ${persona.public.company.name}, on a discovery call with a founder selling a product. Your FULL character (the founder can only see the public part):

${JSON.stringify({ public: persona.public, hidden: persona.hidden }, null, 2)}

CONVERSATION SO FAR:
${transcript || "(the call just started — you gave your intro)"}

FOUNDER'S LATEST QUESTION/STATEMENT:
"${founderText}"

Reply IN CHARACTER as ${persona.public.name}. The rules of the game:
- 1-4 sentences. Real buyers are brief and don't monologue.
- INFORMATION IS EARNED. A sharp, open question that touches one of your real pains earns a substantive answer — share the pain, and a number from your dossier if one fits. A vague, closed, or off-target question gets a true but THIN answer ("yeah, it's fine mostly") — the way real buyers underexplain.
- Dangle gold, don't dump it: when a question gets close to something big (your compelling event, a failed workaround, a frustration), HINT at it in passing ("...we tried building something ourselves, that was an adventure") and let them pull the thread. Only elaborate if they follow up on it.
- Your temperament is "${persona.hidden.temperament}" — let it shape cooperativeness and tone throughout.
- Stay consistent with everything you've already said in the conversation.
- Never mention the product being sold, never sell yourself, never break character.
- Return ONLY the spoken reply, no quotes, no stage directions.`,
      },
    ],
  });
  const reply = (completion.choices[0]?.message?.content || "").trim();
  if (!reply) throw new Error("Discovery reply generation returned empty");
  return reply;
}
