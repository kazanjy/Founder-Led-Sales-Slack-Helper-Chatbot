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

Your response must start with a JSON metadata line, then the extracted content:
Line 1: {"title": "...", "date": "YYYY-MM-DD" or null}
- title: A one-line label (e.g., "Email from John Smith — Pricing Discussion")
- date: The date of the interaction if visible in the screenshot (email date, message timestamp, etc.), in YYYY-MM-DD format. null if no date is visible.

Then a blank line, then the full extracted text content.`,
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

    // Try to parse JSON metadata from the first line
    const lines = extractedText.split("\n");
    let title = "Screenshot";
    let date: string | null = null;
    let contentStartIndex = 0;

    try {
      const firstLine = lines[0]?.trim();
      if (firstLine?.startsWith("{")) {
        const meta = JSON.parse(firstLine);
        title = meta.title || "Screenshot";
        date = meta.date || null;
        contentStartIndex = 1;
        // Skip blank line after JSON
        if (lines[contentStartIndex]?.trim() === "") contentStartIndex++;
      } else {
        title = firstLine?.replace(/^#+\s*/, "").trim() || "Screenshot";
        contentStartIndex = 1;
      }
    } catch {
      title = lines[0]?.replace(/^#+\s*/, "").trim() || "Screenshot";
      contentStartIndex = 1;
    }

    const content = lines.slice(contentStartIndex).join("\n").trim() || extractedText;

    return NextResponse.json({ title, content, date });
  } catch (error) {
    console.error("Error processing screenshot:", error);
    return NextResponse.json({ error: "Failed to process screenshot" }, { status: 500 });
  }
}
