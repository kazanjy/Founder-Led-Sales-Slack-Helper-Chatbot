import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/voice/synthesize-deal-note
 *
 * Body: { transcript: string }
 *
 * Takes a raw voice-to-text transcript (warts and all) and turns it
 * into a clean, structured note suitable for the Deals timeline.
 * Different intent than /api/voice/prettify, which is tuned for
 * cleaning up a casual chat message — this one expects the user is
 * dictating a note about a sales deal and wants a coherent summary
 * they can review and submit.
 *
 * Returns: { summary: string }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { transcript } = await request.json();
    if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
      return NextResponse.json({ error: "transcript required" }, { status: 400 });
    }

    const response = await openai.chat.completions.create({
      // Use the most capable model available — synthesis quality matters
      // more than latency here since the user is reviewing the result
      // before submitting.
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: `You are turning a salesperson's spoken voice memo about a deal into a clean, written deal note.

The input is a raw speech-to-text transcript. It will have run-on sentences, filler words, false starts, and the speaker may circle back to clarify. Your job is to produce a coherent, organized written note that captures everything they said — not a paraphrase, not a summary, not a rewrite that drops detail.

Rules:
- Keep every concrete fact, name, number, date, quote, and decision the speaker mentioned.
- Reorganize into clear sentences and short paragraphs. Use bullet points only when the speaker is listing items.
- Strip filler ("um", "uh", "you know", "like" used as a filler), false starts, and verbal corrections (when they restart a sentence, keep the corrected version only).
- Preserve the speaker's voice and word choice. Don't make it more formal than they sounded.
- Don't add headings or labels (no "Summary:", "Action items:", etc.) unless the speaker explicitly asked for them.
- Don't infer or invent. If they said something ambiguous, leave it ambiguous.
- Output plain prose — no markdown except a bullet list when warranted by the content.

Return ONLY the cleaned-up note text, nothing else.`,
        },
        {
          role: "user",
          content: transcript,
        },
      ],
    });

    const summary = response.choices[0]?.message?.content?.trim();
    if (!summary) {
      return NextResponse.json({ error: "empty synthesis" }, { status: 502 });
    }

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("Error synthesizing deal note:", error);
    return NextResponse.json(
      { error: "Failed to synthesize deal note" },
      { status: 500 }
    );
  }
}
