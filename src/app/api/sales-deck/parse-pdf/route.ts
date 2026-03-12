import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { extractTextFromPDFWithOCR } from "@/lib/pdf-server";

// Allow up to 60s for PDF parsing + OCR
export const maxDuration = 60;

// POST - Extract text from an uploaded PDF for the "Improve Existing" deck flow
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { result } = await extractTextFromPDFWithOCR(buffer, file.name);

    if (!result.fullText.trim()) {
      return NextResponse.json(
        { error: "Could not extract text from this PDF. Please try a different file." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      text: result.fullText,
      fileName: file.name,
      totalPages: result.totalPages,
    });
  } catch (error) {
    console.error("Error parsing PDF:", error);
    return NextResponse.json(
      { error: "Failed to parse PDF" },
      { status: 500 }
    );
  }
}
