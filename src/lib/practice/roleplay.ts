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
