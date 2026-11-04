import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { detectVendor } from "@/lib/call-review/vendors";
import { extractTranscriptFromUrl } from "@/lib/call-review/extract-transcript";

// Allow up to 60s for headless browser extraction
export const maxDuration = 60;

// POST - Extract transcript from a call recording share link
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { url } = await request.json();

    if (!url || typeof url !== "string" || !url.trim()) {
      return NextResponse.json(
        { error: "Please provide a share link URL." },
        { status: 400 },
      );
    }

    // Validate it's a real URL
    try {
      new URL(url.trim());
    } catch {
      return NextResponse.json(
        { error: "Please provide a valid URL." },
        { status: 400 },
      );
    }

    const vendor = detectVendor(url);

    if (!vendor) {
      return NextResponse.json(
        {
          error:
            "Unrecognized share link. We support Sybill, Fathom, Fireflies, Circleback, Otter.ai, Grain, and tl;dv. Please paste your transcript manually instead.",
        },
        { status: 400 },
      );
    }

    if (!vendor.extractable) {
      return NextResponse.json(
        {
          error: vendor.manualPasteInstructions,
          vendor: vendor.name,
          manualInstructions: vendor.manualPasteInstructions,
        },
        { status: 400 },
      );
    }

    console.log(`[extract] User ${user.id} extracting transcript from ${vendor.name}: ${url}`);

    const result = await extractTranscriptFromUrl(url.trim(), vendor);

    if ("error" in result) {
      return NextResponse.json(
        {
          error: result.error,
          vendor: vendor.name,
          manualInstructions: vendor.manualPasteInstructions,
        },
        { status: 422 },
      );
    }

    // Validate extracted transcript length
    if (result.transcript.length < 100) {
      return NextResponse.json(
        {
          error:
            "The extracted transcript appears incomplete (under 100 characters). The page may require login or the transcript is not publicly visible.",
          vendor: vendor.name,
          manualInstructions: vendor.manualPasteInstructions,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      transcript: result.transcript,
      vendor: vendor.name,
      title: result.title || null,
    });
  } catch (error) {
    console.error("[extract] Error:", error);
    return NextResponse.json(
      { error: "Failed to extract transcript. Please paste your transcript manually." },
      { status: 500 },
    );
  }
}
