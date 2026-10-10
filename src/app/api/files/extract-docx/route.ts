import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { extractDocxText, isLegacyDocMime } from "@/lib/files/extract-docx";

/**
 * POST /api/files/extract-docx
 *
 * Server-side .docx text extraction for the web chat upload path.
 * Mammoth is a Node lib; it can't run in the browser. Chat sends the
 * raw .docx bytes as multipart/form-data, this endpoint parses to
 * plain text via the shared extractor and returns the string. The
 * chat page then feeds the text into the message context the same
 * way it does for CSV.
 *
 * Legacy .doc files are rejected with a hint to save as .docx.
 *
 * Body: multipart/form-data with a single `file` field.
 */

export const maxDuration = 60;

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

    if (isLegacyDocMime(file.name, file.type)) {
      return NextResponse.json(
        {
          error:
            "Legacy .doc format is not supported. Please save the document as .docx and re-upload.",
          legacyDoc: true,
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    try {
      const { text, truncated, rawCharCount, warnings } = await extractDocxText(buffer);
      console.log(
        `[extract-docx] ${file.name} — ${rawCharCount} chars${truncated ? " (truncated)" : ""}${warnings.length ? `, ${warnings.length} warnings` : ""}`
      );
      return NextResponse.json({
        text,
        truncated,
        rawCharCount,
        warnings,
      });
    } catch (err) {
      console.error(`[extract-docx] mammoth failed on ${file.name}:`, err);
      return NextResponse.json(
        {
          error:
            "Could not read this Word doc — the file may be encrypted, corrupted, or not a real .docx.",
        },
        { status: 422 }
      );
    }
  } catch (err) {
    console.error("[extract-docx] unhandled error:", err);
    return NextResponse.json({ error: "Extraction failed" }, { status: 500 });
  }
}
