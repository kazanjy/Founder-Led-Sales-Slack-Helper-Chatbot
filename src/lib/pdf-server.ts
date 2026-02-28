/**
 * Server-side PDF processing utilities
 * Uses pdfjs-dist for text extraction without requiring canvas
 */

import * as pdfjsLib from "pdfjs-dist";

// Configure pdfjs for Node.js environment (no worker needed for text extraction)
// Disable worker since we're in a serverless environment
pdfjsLib.GlobalWorkerOptions.workerSrc = "";

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
  // Convert Buffer to Uint8Array for pdfjs
  const uint8Array = new Uint8Array(buffer);

  // Load the PDF document
  const loadingTask = pdfjsLib.getDocument({
    data: uint8Array,
    useSystemFonts: true,
    // Disable features we don't need for text extraction
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const pagesToProcess = Math.min(totalPages, maxPages);

  const pages: Array<{ pageNumber: number; text: string }> = [];
  const textParts: string[] = [];

  // Extract text from each page
  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Combine text items into a single string
      // Handle spacing between items
      let pageText = "";
      let lastY: number | null = null;

      for (const item of textContent.items) {
        if ("str" in item) {
          // Check if we need a newline (different Y position indicates new line)
          if (lastY !== null && "transform" in item) {
            const currentY = item.transform[5];
            if (Math.abs(currentY - lastY) > 5) {
              pageText += "\n";
            } else if (pageText && !pageText.endsWith(" ")) {
              pageText += " ";
            }
          }

          pageText += item.str;

          if ("transform" in item) {
            lastY = item.transform[5];
          }
        }
      }

      // Clean up extra whitespace
      pageText = pageText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join("\n");

      pages.push({
        pageNumber: pageNum,
        text: pageText,
      });

      if (pageText) {
        textParts.push(`--- Page ${pageNum} ---\n${pageText}`);
      }
    } catch (error) {
      console.error(`[PDF] Error extracting text from page ${pageNum}:`, error);
      pages.push({
        pageNumber: pageNum,
        text: `[Error extracting page ${pageNum}]`,
      });
    }
  }

  // Add note if we truncated pages
  let fullText = textParts.join("\n\n");
  if (totalPages > pagesToProcess) {
    fullText += `\n\n[Note: PDF has ${totalPages} pages total, showing first ${pagesToProcess}]`;
  }

  return {
    fileName,
    totalPages,
    pages,
    fullText,
  };
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
