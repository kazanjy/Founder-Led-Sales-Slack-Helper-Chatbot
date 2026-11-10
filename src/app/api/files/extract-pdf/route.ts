import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { extractTextFromPDFWithOCR, formatPDFForAIWithOCR } from "@/lib/pdf-server";

/**
 * POST /api/files/extract-pdf
 *
 * Generic PDF → verbatim text extraction for the web chat upload
 * path. Uses the SAME core as the Slack pipeline and the collateral
 * library: extractTextFromPDFWithOCR (unpdf text-layer extraction,
 * with an OCR fallback only for scanned/image PDFs). Returns the full
 * document text — NOT a Vision-generated page summary.
 *
 * Before this, the web chat rendered each PDF page to an image and
 * ran it through the Vision API, which produced a paraphrased
 * *description* of each page rather than the actual text. Uploading a
 * proposal/contract lost fidelity. This endpoint gives the model the
 * real text so it can quote and reason over the document verbatim.
 *
 * Body: multipart/form-data with a single `file` field.
 */

export const maxDuration = 120;

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB
// Cap the returned text so a giant document doesn't dominate the
// model context. Matches the collateral extractor's ceiling.
const MAX_TEXT_CHARS = 200_000;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file field is required" }, { status: 400 });
    }

    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: `PDF exceeds ${MAX_PDF_BYTES / 1024 / 1024}MB limit` },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { result, usedOCR } = await extractTextFromPDFWithOCR(buffer, file.name);
    const fullText = (result.fullText || "").trim();

    if (!fullText) {
      // Genuinely unreadable (empty / scanned-with-no-OCR-hit). Let the
      // caller surface a note rather than silently returning nothing.
      return NextResponse.json(
        {
          error:
            "Could not extract text from this PDF — it may be image-only or scanned. Try a text-based PDF, or paste the content directly.",
          empty: true,
        },
        { status: 422 }
      );
    }

    const truncated = fullText.length > MAX_TEXT_CHARS;
    const boundedText = truncated
      ? fullText.substring(0, MAX_TEXT_CHARS) + "\n\n… [truncated — original was " + fullText.length + " chars]"
      : fullText;

    // Format with the same [PDF: name · N pages] header the Slack path
    // uses so the model context is consistent across surfaces.
    const content = formatPDFForAIWithOCR(
      { ...result, fullText: boundedText },
      usedOCR
    );

    console.log(
      `[extract-pdf] ${file.name} — ${result.totalPages} pages, ${fullText.length} chars${usedOCR ? " (OCR)" : ""}${truncated ? " (truncated)" : ""}`
    );

    return NextResponse.json({
      content,
      pageCount: result.totalPages,
      charCount: fullText.length,
      usedOCR,
      truncated,
    });
  } catch (err) {
    console.error("[extract-pdf] error:", err);
    return NextResponse.json({ error: "Failed to extract PDF" }, { status: 500 });
  }
}
