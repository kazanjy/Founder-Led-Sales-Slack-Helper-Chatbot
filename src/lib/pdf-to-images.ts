"use client";

export interface PDFPageImage {
  pageNumber: number;
  dataUrl: string; // base64 data URL
  width: number;
  height: number;
}

export interface PDFConversionResult {
  fileName: string;
  totalPages: number;
  pages: PDFPageImage[];
}

/**
 * Convert a PDF file to an array of images (one per page)
 * Uses dynamic import to ensure pdfjs-dist only loads in the browser
 * @param file - The PDF file to convert
 * @param options - Conversion options
 * @returns Array of page images as base64 data URLs
 */
export async function convertPDFToImages(
  file: File,
  options: {
    maxPages?: number; // Limit number of pages to convert (default: 50)
    scale?: number; // Render scale (default: 1.5 for good quality)
    format?: "png" | "jpeg"; // Output format (default: jpeg for smaller size)
    quality?: number; // JPEG quality 0-1 (default: 0.8)
  } = {}
): Promise<PDFConversionResult> {
  // Ensure we're in a browser environment
  if (typeof window === "undefined") {
    throw new Error("convertPDFToImages can only be called in the browser");
  }

  const {
    maxPages = 50,
    scale = 1.5,
    format = "jpeg",
    quality = 0.8,
  } = options;

  // Dynamic import to avoid loading pdfjs-dist on the server
  const pdfjsLib = await import("pdfjs-dist");

  // Set up the worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  // Read file as ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();

  // Load the PDF document
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  const pagesToConvert = Math.min(totalPages, maxPages);

  const pages: PDFPageImage[] = [];

  // Convert each page to an image
  for (let pageNum = 1; pageNum <= pagesToConvert; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    // Create a canvas to render the page
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not get canvas context");
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render the page to the canvas
    await page.render({
      canvasContext: context,
      viewport,
      canvas,
    }).promise;

    // Convert canvas to data URL
    const mimeType = format === "png" ? "image/png" : "image/jpeg";
    const dataUrl = canvas.toDataURL(mimeType, quality);

    pages.push({
      pageNumber: pageNum,
      dataUrl,
      width: viewport.width,
      height: viewport.height,
    });
  }

  return {
    fileName: file.name,
    totalPages,
    pages,
  };
}

/**
 * Check if a file is a PDF
 */
export function isPDFFile(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}
