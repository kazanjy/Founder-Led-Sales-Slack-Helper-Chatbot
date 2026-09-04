import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    // Transcribe using Whisper with a prompt to reduce hallucinations
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language: "en",
      prompt: "This is a user speaking to a sales assistant named Mikey. They are asking questions about founder-led sales, discussing their deals, or requesting help with sales strategies.",
    });

    return NextResponse.json({
      text: transcription.text,
    });
  } catch (error) {
    console.error("Error transcribing audio:", error);
    return NextResponse.json(
      { error: "Failed to transcribe audio" },
      { status: 500 }
    );
  }
}
