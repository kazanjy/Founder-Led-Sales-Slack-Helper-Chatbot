import { openai } from "@/lib/openai";

export interface AttributionParticipant {
  id: string;
  name: string;
  title?: string | null;
  email?: string | null;
  company?: string | null;
}

export interface AttributionResult {
  matchedParticipantIds: string[];
}

/**
 * Given a piece of timeline content (email, chat, transcript, etc.) and the
 * deal's participant roster, ask GPT-4o-mini which participants are mentioned,
 * referenced, or communicating in the content. Returns a list of participant
 * IDs that the model believes this entry references.
 *
 * Kept deliberately small and cheap — no "new people" extraction here; that's
 * handled by the screenshot flow where visual cues are richer.
 */
export async function attributeEntryToParticipants(
  content: string,
  participants: AttributionParticipant[],
  ownerLabel: string,
): Promise<AttributionResult> {
  if (!content || participants.length === 0) {
    return { matchedParticipantIds: [] };
  }

  const roster = participants
    .map((p) => {
      const bits: string[] = [`- id=${p.id} name="${p.name}"`];
      if (p.title) bits.push(`title="${p.title}"`);
      if (p.email) bits.push(`email="${p.email}"`);
      if (p.company) bits.push(`company="${p.company}"`);
      return bits.join(" ");
    })
    .join("\n");

  const systemPrompt = `You identify which people from a B2B sales deal's participant roster are mentioned, referenced, or communicating in a piece of content (email, chat message, LinkedIn message, call transcript, or note).

Deal owner (the person who added this content): ${ownerLabel}

Known participants on this deal — match names/emails in the content against these:
${roster}

Use fuzzy matching — first names alone are fine if unambiguous; email domains help. Do NOT include the owner. Only include IDs that actually appear in the content (as sender/recipient/speaker/clearly referenced by name). Exclude people only tangentially mentioned (e.g. "I talked to someone from their team" with no name).

Return ONE line of JSON and nothing else: {"matchedParticipantIds": ["..."]}

Empty array if nobody in the roster is clearly referenced.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: content.substring(0, 8000) },
      ],
      max_completion_tokens: 200,
      temperature: 0.1,
    });
    const raw = response.choices[0]?.message?.content?.trim() || "";
    const match = raw.match(/\{[^\n}]*\}/);
    if (!match) return { matchedParticipantIds: [] };
    const parsed = JSON.parse(match[0]) as { matchedParticipantIds?: unknown };
    if (!Array.isArray(parsed.matchedParticipantIds)) return { matchedParticipantIds: [] };
    const knownIds = new Set(participants.map((p) => p.id));
    const matchedParticipantIds = (parsed.matchedParticipantIds as unknown[])
      .filter((x): x is string => typeof x === "string" && knownIds.has(x));
    return { matchedParticipantIds };
  } catch (err) {
    console.error("attributeEntryToParticipants failed:", err);
    return { matchedParticipantIds: [] };
  }
}
