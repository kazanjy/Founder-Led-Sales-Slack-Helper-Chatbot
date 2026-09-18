import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { transcript } = await request.json();

    if (!transcript || typeof transcript !== "string") {
      return NextResponse.json({ error: "No transcript provided" }, { status: 400 });
    }

    // Use GPT to clean up the raw transcription
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a transcript editor. Take the raw speech-to-text transcription and clean it up into a clear, coherent message while preserving the original meaning and intent.

Rules:
- Fix grammar, punctuation, and run-on sentences
- Remove filler words (um, uh, like, you know) unless they add meaning
- Keep the same tone and intent as the original
- Don't add information that wasn't in the original
- Keep it concise
- Return ONLY the cleaned up text, nothing else`,
        },
        {
          role: "user",
          content: transcript,
        },
      ],
      max_completion_tokens: 500,
      temperature: 0.3,
    });

    const prettified = response.choices[0]?.message?.content?.trim() || transcript;

    return NextResponse.json({ prettified });
  } catch (error) {
    console.error("Error prettifying transcript:", error);
    return NextResponse.json(
      { error: "Failed to prettify transcript" },
      { status: 500 }
    );
  }
}
