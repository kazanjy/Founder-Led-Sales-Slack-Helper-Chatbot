/**
 * Server-side PDF processing utilities
 * Uses unpdf for text extraction (serverless-compatible, no browser APIs needed)
 * Falls back to OCR (Vision API) when PDFs have no extractable text
 */

import { extractText, getDocumentProxy } from "unpdf";
import { needsOCR, performPDFOCR, formatOCRForAI } from "./pdf-ocr";

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

/**
 * Extract text from PDF with automatic OCR fallback
 * If normal text extraction yields little/no text (e.g., scanned PDFs),
 * automatically falls back to OCR using Vision API
 *
 * @param buffer - The PDF file as a Buffer
 * @param fileName - Original filename for reference
 * @param maxPages - Maximum pages to extract (default: 50)
 * @param enableOCR - Whether to enable OCR fallback (default: true)
 * @returns Extracted text content organized by page
 */
export async function extractTextFromPDFWithOCR(
  buffer: Buffer,
  fileName: string,
  maxPages: number = 50,
  enableOCR: boolean = true
): Promise<{ result: PDFTextExtractionResult; usedOCR: boolean }> {
  // First, try normal text extraction
  const textResult = await extractTextFromPDF(buffer, fileName, maxPages);

  // Check if we got meaningful text
  if (!enableOCR || !needsOCR(textResult.pages, textResult.totalPages)) {
    return { result: textResult, usedOCR: false };
  }

  // Text extraction yielded little/no text - fall back to OCR
  console.log(`[PDF] "${fileName}" has insufficient text (${textResult.fullText.length} chars), falling back to OCR`);

  try {
    // Limit OCR pages to 20 for cost control (Vision API is more expensive)
    const ocrMaxPages = Math.min(maxPages, 20);
    const ocrResult = await performPDFOCR(buffer, fileName, ocrMaxPages);

    // Convert OCR result to PDFTextExtractionResult format
    const convertedResult: PDFTextExtractionResult = {
      fileName: ocrResult.fileName,
      totalPages: ocrResult.totalPages,
      pages: ocrResult.pages,
      fullText: ocrResult.fullText,
    };

    return { result: convertedResult, usedOCR: true };
  } catch (error) {
    console.error(`[PDF] OCR fallback failed for "${fileName}":`, error);
    // Return original (sparse) result if OCR fails
    return { result: textResult, usedOCR: false };
  }
}

/**
 * Format PDF content for AI, with awareness of OCR usage
 */
export function formatPDFForAIWithOCR(
  result: PDFTextExtractionResult,
  usedOCR: boolean
): string {
  if (!result.fullText || result.fullText.trim().length === 0) {
    return `[PDF: ${result.fileName}]\nThis PDF appears to contain no extractable text (may be image-based or scanned).`;
  }

  const suffix = usedOCR ? ", OCR extracted" : "";
  return `[PDF: ${result.fileName} (${result.totalPages} page${result.totalPages !== 1 ? "s" : ""}${suffix})]\n\n${result.fullText}`;
}
