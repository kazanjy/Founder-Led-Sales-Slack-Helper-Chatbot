/**
 * Server-side PDF processing utilities
 * Uses unpdf for text extraction (serverless-compatible, no browser APIs needed)
 */

import { extractText, getDocumentProxy } from "unpdf";

export interface PDFTextExtractionResult {
  fileName: string;
  totalPages: number;
  pages: Array<{
    pageNumber: number;
    text: string;
  }>;
  fullText: string;
}

/**
 * Extract text content from a PDF buffer
 * @param buffer - The PDF file as a Buffer
 * @param fileName - Original filename for reference
 * @param maxPages - Maximum pages to extract (default: 50)
 * @returns Extracted text content organized by page
 */
export async function extractTextFromPDF(
  buffer: Buffer,
  fileName: string,
  maxPages: number = 50
): Promise<PDFTextExtractionResult> {
  try {
    // Convert Buffer to Uint8Array for unpdf
    const uint8Array = new Uint8Array(buffer);

    // Load the PDF document
    const pdf = await getDocumentProxy(uint8Array);
    const totalPages = pdf.numPages;
    const pagesToProcess = Math.min(totalPages, maxPages);

    // Extract text - unpdf can return pages separately
    const result = await extractText(pdf, { mergePages: false });

    // Build pages array from extracted text
    const pages: Array<{ pageNumber: number; text: string }> = [];
    const textParts: string[] = [];

    // result.text is an array when mergePages is false
    const pageTexts = Array.isArray(result.text) ? result.text : [result.text];

    for (let i = 0; i < Math.min(pageTexts.length, pagesToProcess); i++) {
      const pageText = (pageTexts[i] || "").trim();
      pages.push({
        pageNumber: i + 1,
        text: pageText,
      });

      if (pageText) {
        textParts.push(`--- Page ${i + 1} ---\n${pageText}`);
      }
    }

    // Format full text with page markers
    let fullText = textParts.join("\n\n");

    // Add note if we truncated pages
    if (totalPages > pagesToProcess) {
      fullText += `\n\n[Note: PDF has ${totalPages} pages total, showing first ${pagesToProcess}]`;
    }

    return {
      fileName,
      totalPages,
      pages,
      fullText,
    };
  } catch (error) {
    console.error(`[PDF] Error extracting text from PDF:`, error);
    // Return empty result on error
    return {
      fileName,
      totalPages: 0,
      pages: [],
      fullText: `[Error: Could not extract text from PDF "${fileName}"]`,
    };
  }
}

/**
 * Check if a MIME type is a PDF
 */
export function isPDFMimeType(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

/**
 * Format PDF content for inclusion in a message to the AI
 * @param result - The PDF text extraction result
 * @returns Formatted string describing the PDF content
 */
export function formatPDFForAI(result: PDFTextExtractionResult): string {
  if (!result.fullText || result.fullText.trim().length === 0) {
    return `[PDF: ${result.fileName}]\nThis PDF appears to contain no extractable text (may be image-based or scanned).`;
  }

  return `[PDF: ${result.fileName} (${result.totalPages} page${result.totalPages !== 1 ? "s" : ""})]\n\n${result.fullText}`;
}
