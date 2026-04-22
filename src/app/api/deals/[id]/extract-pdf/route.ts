import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { extractTextFromPDFWithOCR } from "@/lib/pdf-server";

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB

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

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
    }

    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: `PDF exceeds ${MAX_PDF_BYTES / 1024 / 1024}MB limit` },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { result, usedOCR } = await extractTextFromPDFWithOCR(buffer, file.name);

    const fullText = result.fullText?.trim() || "";
    const fileBaseName = file.name.replace(/\.pdf$/i, "");

    if (!fullText) {
      return NextResponse.json(
        { error: "Could not extract any text from this PDF" },
        { status: 422 },
      );
    }

    // Ask GPT for a short title and any visible date in the document. We only
    // send the first slice to keep latency/cost down — titles and dates almost
    // always appear near the top of sales docs (proposals, contracts, etc.).
    let title = fileBaseName;
    let date: string | null = null;
    try {
      const today = new Date();
      const todayIso = today.toISOString().slice(0, 10);
      const metadataPrompt = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You extract metadata from the opening pages of a sales-related PDF (proposal, contract, one-pager, deck export, etc.).

Today's date is ${todayIso}. If a date in the document shows only a month and day with no year, assume the current year (${today.getFullYear()}). Only use a different year if the document clearly shows one. Never default to a year before ${today.getFullYear() - 1} unless explicitly stated.

Return ONE line of JSON and nothing else:
{"title": "...", "date": "YYYY-MM-DD" or null}

- title: a concise one-line label (e.g. "MSA — Visana Health", "Q2 Pricing Proposal"). Prefer the document's own title over the filename. Keep under 80 chars.
- date: the document's effective/issued date if visible, in YYYY-MM-DD. null if no clear date is present.`,
          },
          {
            role: "user",
            content: `Filename: ${file.name}\n\nFirst 1500 chars:\n${fullText.substring(0, 1500)}`,
          },
        ],
        max_completion_tokens: 120,
        temperature: 0.1,
      });

      const raw = metadataPrompt.choices[0]?.message?.content?.trim() || "";
      const jsonLine = raw.match(/\{[^\n}]*\}/)?.[0];
      if (jsonLine) {
        const parsed = JSON.parse(jsonLine) as { title?: string; date?: string | null };
        if (parsed.title && typeof parsed.title === "string") title = parsed.title.trim();
        if (parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) date = parsed.date;
      }
    } catch (err) {
      console.error("PDF metadata extraction failed, falling back to filename:", err);
    }

    const header = `[PDF: ${file.name} · ${result.totalPages} page${result.totalPages !== 1 ? "s" : ""}${usedOCR ? " · OCR extracted" : ""}]`;
    const content = `${header}\n\n${fullText}`;

    return NextResponse.json({ title, content, date });
  } catch (error) {
    console.error("Error extracting PDF:", error);
    return NextResponse.json({ error: "Failed to extract PDF" }, { status: 500 });
  }
}
