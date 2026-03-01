/**
 * Server-side PDF OCR utilities
 * Converts PDF pages to images and uses Vision API for text extraction
 * This is used as a fallback when PDFs have no extractable text (scanned/image-based)
 */

import { openai } from "@/lib/openai";

interface PDFOCRResult {
  fileName: string;
  totalPages: number;
  pages: Array<{
    pageNumber: number;
    text: string;
  }>;
  fullText: string;
}

/**
 * Minimum average characters per page to consider a PDF as having valid text.
 * Below this threshold, we'll attempt OCR.
 */
const MIN_CHARS_PER_PAGE = 50;

/**
 * Check if a PDF extraction result needs OCR
 * Returns true if the extracted text is too sparse (likely scanned/image-based)
 */
export function needsOCR(
  pages: Array<{ text: string }>,
  totalPages: number
): boolean {
  if (totalPages === 0) return false;

  // Calculate average characters per page
  const totalChars = pages.reduce((sum, page) => sum + (page.text?.length || 0), 0);
  const avgCharsPerPage = totalChars / totalPages;

  console.log(`[PDF OCR] Checking if OCR needed: ${totalChars} total chars, ${avgCharsPerPage.toFixed(0)} avg per page, threshold: ${MIN_CHARS_PER_PAGE}`);

  return avgCharsPerPage < MIN_CHARS_PER_PAGE;
}

/**
 * Extract text from a PDF page image using OpenAI Vision API
 */
async function extractTextFromImage(
  imageBase64: string,
  pageNumber: number
): Promise<string> {
  console.log(`[PDF OCR] Extracting text from page ${pageNumber}`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an OCR system. Extract ALL text from this document image exactly as it appears.
Preserve:
- The logical reading order (top to bottom, left to right)
- Paragraph structure and line breaks
- Headers and titles (mark them clearly)
- Lists and bullet points
- Table content (format as best as possible)

Do NOT:
- Add commentary or interpretation
- Summarize or paraphrase
- Skip any text, even if it seems unimportant

Return the extracted text only, formatted for readability.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract all text from this document page.",
          },
          {
            type: "image_url",
            image_url: {
              url: imageBase64,
              detail: "high",
            },
          },
        ],
      },
    ],
    max_tokens: 4000,
    temperature: 0.1, // Low temperature for accurate extraction
  });

  const text = response.choices[0]?.message?.content?.trim() || "";
  console.log(`[PDF OCR] Page ${pageNumber}: extracted ${text.length} chars`);

  return text;
}

/**
 * Convert PDF buffer to images using server-side rendering
 * Uses pdfjs-dist with node-canvas for rendering
 */
async function convertPDFToImagesServer(
  buffer: Buffer,
  maxPages: number = 20
): Promise<Array<{ pageNumber: number; dataUrl: string }>> {
  // Dynamic import to handle canvas availability
  const { getDocumentProxy } = await import("unpdf");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let canvasModule: any;

  try {
    // Try to use node-canvas for server-side rendering
    canvasModule = await import("canvas");
  } catch {
    console.error("[PDF OCR] canvas package not available. Install with: npm install canvas");
    throw new Error("Server-side PDF rendering requires the 'canvas' package");
  }

  // Dynamic import pdfjs-dist for server
  const pdfjsLib = await import("pdfjs-dist");

  const uint8Array = new Uint8Array(buffer);
  const pdf = await getDocumentProxy(uint8Array);
  const totalPages = pdf.numPages;
  const pagesToProcess = Math.min(totalPages, maxPages);

  console.log(`[PDF OCR] Converting ${pagesToProcess} of ${totalPages} pages to images`);

  const pages: Array<{ pageNumber: number; dataUrl: string }> = [];
  const scale = 2.0; // Higher scale for better OCR accuracy

  // Get the actual pdfjs document for rendering
  const pdfDocument = await pdfjsLib.getDocument({ data: uint8Array }).promise;

  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
    try {
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      // Create canvas for this page using node-canvas
      const nodeCanvas = canvasModule.createCanvas(viewport.width, viewport.height);
      const context = nodeCanvas.getContext("2d");

      if (!context) {
        console.error(`[PDF OCR] Could not get canvas context for page ${pageNum}`);
        continue;
      }

      // Render the page - use 'any' cast for cross-environment compatibility
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.render({
        canvasContext: context as any,
        viewport,
        canvas: nodeCanvas as any,
      }).promise;

      // Convert to base64
      const dataUrl = nodeCanvas.toDataURL("image/jpeg", 0.85);

      pages.push({
        pageNumber: pageNum,
        dataUrl,
      });

      console.log(`[PDF OCR] Rendered page ${pageNum}`);
    } catch (error) {
      console.error(`[PDF OCR] Error rendering page ${pageNum}:`, error);
    }
  }

  return pages;
}

/**
 * Perform OCR on a PDF buffer using Vision API
 * @param buffer - The PDF file as a Buffer
 * @param fileName - Original filename for reference
 * @param maxPages - Maximum pages to process (default: 20 for cost control)
 * @returns Extracted text content organized by page
 */
export async function performPDFOCR(
  buffer: Buffer,
  fileName: string,
  maxPages: number = 20
): Promise<PDFOCRResult> {
  console.log(`[PDF OCR] Starting OCR for "${fileName}"`);

  try {
    // Convert PDF to images
    const pageImages = await convertPDFToImagesServer(buffer, maxPages);

    if (pageImages.length === 0) {
      return {
        fileName,
        totalPages: 0,
        pages: [],
        fullText: `[Error: Could not render PDF "${fileName}" for OCR]`,
      };
    }

    // Process pages with Vision API (can parallelize for speed, but sequential for reliability)
    const pages: Array<{ pageNumber: number; text: string }> = [];
    const textParts: string[] = [];

    // Process pages in batches of 3 to balance speed and API rate limits
    const batchSize = 3;
    for (let i = 0; i < pageImages.length; i += batchSize) {
      const batch = pageImages.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (page) => {
          const text = await extractTextFromImage(page.dataUrl, page.pageNumber);
          return { pageNumber: page.pageNumber, text };
        })
      );

      for (const result of batchResults) {
        pages.push(result);
        if (result.text) {
          textParts.push(`--- Page ${result.pageNumber} ---\n${result.text}`);
        }
      }
    }

    // Sort pages by number (in case parallel processing returned out of order)
    pages.sort((a, b) => a.pageNumber - b.pageNumber);

    let fullText = textParts.join("\n\n");

    // Add note about OCR processing
    const totalPages = pageImages.length;
    if (totalPages > 0) {
      fullText = `[OCR extracted from scanned PDF]\n\n${fullText}`;
    }

    console.log(`[PDF OCR] Completed OCR for "${fileName}": ${pages.length} pages, ${fullText.length} chars`);

    return {
      fileName,
      totalPages,
      pages,
      fullText,
    };
  } catch (error) {
    console.error(`[PDF OCR] Error performing OCR:`, error);
    return {
      fileName,
      totalPages: 0,
      pages: [],
      fullText: `[Error: Could not perform OCR on PDF "${fileName}"]`,
    };
  }
}

/**
 * Format OCR result for AI consumption (matches formatPDFForAI signature)
 */
export function formatOCRForAI(result: PDFOCRResult): string {
  if (!result.fullText || result.fullText.trim().length === 0) {
    return `[PDF: ${result.fileName}]\nCould not extract text from this PDF even with OCR.`;
  }

  return `[PDF: ${result.fileName} (${result.totalPages} page${result.totalPages !== 1 ? "s" : ""}, OCR extracted)]\n\n${result.fullText}`;
}
