import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const deal = await prisma.deal.findUnique({ where: { id } });
    if (!deal || deal.userId !== user.id) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const { imageBase64, mimeType } = (await request.json()) as {
      imageBase64: string;
      mimeType: string;
    };

    if (!imageBase64) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are extracting text content from a screenshot related to a B2B sales deal. The image might be an email, Slack message, LinkedIn conversation, CRM screenshot, proposal, or contract excerpt.

Extract ALL readable text from the image. Preserve the structure (sender, timestamps, message content). If it's a conversation, format it clearly with speaker attribution. If it's a document, preserve headings and sections.

At the top, add a one-line label describing what this screenshot shows (e.g., "Email from John Smith — Pricing Discussion", "Slack thread — Technical Requirements", "LinkedIn message — Introduction").`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all text from this screenshot:" },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType || "image/png"};base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_completion_tokens: 2000,
      temperature: 0.2,
    });

    const extractedText = response.choices[0]?.message?.content?.trim() || "";

    if (!extractedText) {
      return NextResponse.json({ error: "Could not extract text from image" }, { status: 422 });
    }

    // Parse the first line as the title
    const lines = extractedText.split("\n");
    const title = lines[0]?.replace(/^#+\s*/, "").trim() || "Screenshot";
    const content = lines.slice(1).join("\n").trim() || extractedText;

    return NextResponse.json({ title, content });
  } catch (error) {
    console.error("Error processing screenshot:", error);
    return NextResponse.json({ error: "Failed to process screenshot" }, { status: 500 });
  }
}
