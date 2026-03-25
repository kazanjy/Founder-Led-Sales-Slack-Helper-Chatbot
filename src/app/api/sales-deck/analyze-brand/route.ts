import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { captureScreenshot } from "@/lib/screenshotone";
import { openai } from "@/lib/openai";

// Allow up to 60s for screenshot capture + vision analysis
export const maxDuration = 60;

/**
 * POST /api/sales-deck/analyze-brand
 *
 * Captures a screenshot of the prospect's website via ScreenshotOne,
 * then analyzes it with OpenAI 4o vision to extract brand aesthetics.
 *
 * Input: { url: string }
 * Output: { brandAnalysis: string, screenshotDataUrl: string }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { url } = await request.json();
    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Normalize URL
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;

    // 1. Capture screenshot via ScreenshotOne
    console.log(`[analyze-brand] Capturing screenshot of ${normalizedUrl}`);
    let screenshot;
    try {
      screenshot = await captureScreenshot({
        url: normalizedUrl,
        format: "png",
        viewportWidth: 1440,
        viewportHeight: 900,
        fullPage: false,
        deviceScaleFactor: 1,
        delay: 2000,
        blockCookieBanners: true,
        blockAds: true,
      });
    } catch (screenshotError) {
      console.error("[analyze-brand] Screenshot capture failed:", screenshotError);
      return NextResponse.json(
        { error: "Failed to capture website screenshot. The URL may be unreachable." },
        { status: 422 }
      );
    }

    // 2. Analyze with OpenAI 4o vision
    console.log("[analyze-brand] Analyzing brand aesthetics with GPT-4o vision");
    const visionResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: BRAND_ANALYSIS_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze the brand aesthetics of this website homepage screenshot from ${normalizedUrl}. Provide a detailed brand analysis that can be used to generate a matching sales deck.`,
            },
            {
              type: "image_url",
              image_url: {
                url: screenshot.dataUrl,
                detail: "high",
              },
            },
          ],
        },
      ],
      max_tokens: 1500,
      temperature: 0.3,
    });

    const brandAnalysis = visionResponse.choices[0]?.message?.content?.trim() || "";
    console.log(`[analyze-brand] Analysis complete: ${brandAnalysis.length} chars`);

    return NextResponse.json({
      brandAnalysis,
      screenshotDataUrl: screenshot.dataUrl,
      url: normalizedUrl,
    });
  } catch (error) {
    console.error("[analyze-brand] Error:", error);
    return NextResponse.json(
      { error: "Failed to analyze brand aesthetics" },
      { status: 500 }
    );
  }
}

const BRAND_ANALYSIS_PROMPT = `You are a brand aesthetics analyst. Given a screenshot of a company's website homepage, analyze the visual brand identity and describe it in a way that can be used to generate a matching sales presentation.

Provide your analysis in the following structured format:

## Color Palette
- Primary brand color(s) with hex codes if discernible
- Secondary/accent colors
- Background colors (light/dark theme)
- Text colors

## Typography Feel
- Heading style (bold, light, serif, sans-serif, geometric, humanist)
- Overall typographic weight (heavy, medium, light)
- Spacing feel (tight, comfortable, airy)

## Visual Style
- Overall aesthetic (modern, traditional, minimalist, bold, playful, corporate, etc.)
- Use of imagery (photography, illustrations, icons, abstract)
- Layout density (spacious, balanced, dense)
- Shape language (rounded, sharp, mixed)

## Brand Personality
- 3-5 adjectives that describe the brand personality conveyed by the visuals
- Tone (formal, casual, technical, friendly, authoritative)

## Presentation Tone Recommendation
A 2-3 sentence description of how a sales deck should look and feel to match this brand's aesthetic. This will be used as a "tone" parameter for deck generation.

Be specific and actionable. Focus on visual characteristics that can inform slide design.`;
