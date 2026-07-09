import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { text, voice } = await request.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    // Limit text length to avoid excessive costs
    const truncatedText = text.slice(0, 4096);

    // Voice selection: nova (the coach) by default; practice-roleplay
    // personas pass their gender-matched voice so the synthetic buyer
    // doesn't sound like Mikey.
    const VALID_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
    type TtsVoice = (typeof VALID_VOICES)[number];
    const selectedVoice: TtsVoice =
      typeof voice === "string" && (VALID_VOICES as readonly string[]).includes(voice)
        ? (voice as TtsVoice)
        : "nova";

    // Generate speech using OpenAI TTS
    const mp3Response = await openai.audio.speech.create({
      model: "tts-1",
      voice: selectedVoice,
      input: truncatedText,
    });

    // Get the audio as a buffer
    const audioBuffer = Buffer.from(await mp3Response.arrayBuffer());

    // Return as audio stream
    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Error generating speech:", error);
    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 }
    );
  }
}
