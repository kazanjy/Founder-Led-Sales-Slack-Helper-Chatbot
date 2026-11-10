import { extractTextFromPDF, isPDFMimeType } from "@/lib/pdf-server";
import { extractDocxText, isDocxFile, DOCX_MIME_TYPE } from "@/lib/files/extract-docx";

/**
 * Uniform text extractor for collateral-library uploads. Wraps the
 * existing PDF and DOCX parsers behind a single call so the upload
 * endpoint doesn't have to branch on MIME type. Returns { text,
 * pageCount, status } — status = "done" on success, "ocr_needed"
 * when the PDF text layer was empty (scanned image), "failed" on
 * unrecoverable errors.
 *
 * OCR is deliberately not attempted in Phase 1 — surface
 * "ocr_needed" so the UI can offer a re-upload nudge. Phase 2 can
 * wire in the existing OCR path (extractTextFromPDFWithOCR).
 */

export interface CollateralExtractResult {
  text: string;
  pageCount: number | null;
  status: "done" | "ocr_needed" | "failed";
  reason?: string;
}

const MAX_EXTRACTED_CHARS = 200_000;

export async function extractCollateralText(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<CollateralExtractResult> {
  try {
    if (isPDFMimeType(mimeType)) {
      const result = await extractTextFromPDF(buffer, fileName);
      const raw = (result.fullText || "").trim();
      if (!raw) {
        return {
          text: "",
          pageCount: result.totalPages || null,
          status: "ocr_needed",
          reason: "PDF text layer was empty — likely a scanned document.",
        };
      }
      return {
        text: raw.length > MAX_EXTRACTED_CHARS ? raw.substring(0, MAX_EXTRACTED_CHARS) : raw,
        pageCount: result.totalPages || null,
        status: "done",
      };
    }

    if (mimeType === DOCX_MIME_TYPE || isDocxFile(fileName, mimeType)) {
      const { text, rawCharCount } = await extractDocxText(buffer);
      if (!text) {
        return {
          text: "",
          pageCount: null,
          status: "failed",
          reason: "DOCX had no extractable text.",
        };
      }
      return {
        text: rawCharCount > MAX_EXTRACTED_CHARS ? text.substring(0, MAX_EXTRACTED_CHARS) : text,
        pageCount: null,
        status: "done",
      };
    }

    return {
      text: "",
      pageCount: null,
      status: "failed",
      reason: `Unsupported MIME type: ${mimeType}`,
    };
  } catch (err) {
    return {
      text: "",
      pageCount: null,
      status: "failed",
      reason: err instanceof Error ? err.message : "Extractor threw",
    };
  }
}

/** True when the mimetype/name maps to a format we can extract text from. */
export function isSupportedCollateralUpload(fileName: string, mimeType: string): boolean {
  return isPDFMimeType(mimeType) || isDocxFile(fileName, mimeType);
}
