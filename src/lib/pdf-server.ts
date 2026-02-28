/**
 * Server-side PDF processing utilities
 * Uses pdf-parse for text extraction (Node.js compatible, no browser APIs needed)
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");

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
    // Configure pdf-parse options
    const options = {
      // Limit pages if needed
      max: maxPages,
    };

    const data = await pdfParse(buffer, options);

    // pdf-parse returns full text, we'll split by page markers if present
    // or treat as single block
    const fullText = data.text || "";
    const totalPages = data.numpages || 1;

    // Since pdf-parse doesn't provide page-by-page extraction directly,
    // we'll provide the full text with page count info
    const pages: Array<{ pageNumber: number; text: string }> = [];

    // Try to split by common page break patterns
    const pageTexts = fullText.split(/\f/); // Form feed is often used as page break

    if (pageTexts.length > 1) {
      // We have page breaks, use them
      const pagesToProcess = Math.min(pageTexts.length, maxPages);
      for (let i = 0; i < pagesToProcess; i++) {
        const pageText = pageTexts[i].trim();
        if (pageText) {
          pages.push({
            pageNumber: i + 1,
            text: pageText,
          });
        }
      }
    } else {
      // Single block of text, treat as one page
      pages.push({
        pageNumber: 1,
        text: fullText.trim(),
      });
    }

    // Format full text with page markers if we have multiple pages
    let formattedFullText = "";
    if (pages.length > 1) {
      formattedFullText = pages
        .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
        .join("\n\n");
    } else {
      formattedFullText = fullText.trim();
    }

    // Add note if we truncated pages
    if (totalPages > maxPages) {
      formattedFullText += `\n\n[Note: PDF has ${totalPages} pages total, showing first ${maxPages}]`;
    }

    return {
      fileName,
      totalPages,
      pages,
      fullText: formattedFullText,
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
