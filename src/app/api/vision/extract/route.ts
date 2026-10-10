import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { getCurrentUser } from "@/lib/auth";

type ExtractionType = "general" | "sales" | "document";
type ImageType = "screenshot" | "document" | "photo" | "chart" | "unknown";

interface ExtractRequest {
  image: string; // base64 data URL or HTTP URL
  context?: string; // user hint: "competitor pricing page"
  extractionType?: ExtractionType;
}

interface ExtractResponse {
  description: string;
  metadata: {
    type: ImageType;
    confidence: number;
  };
}

// Extraction prompts by type
const EXTRACTION_PROMPTS: Record<ExtractionType, string> = {
  general: `Analyze this image and provide a detailed description. Include:
- What the image shows (objects, text, people, etc.)
- Any visible text or numbers
- The overall context or purpose of the image
- Key details that would be relevant to understand the content`,

  sales: `Analyze this image from a sales and business perspective. Extract:
- Any visible text, numbers, or data
- Pricing information, tiers, or plans if present
- Product features or capabilities mentioned
- Company or competitor information
- Organizational details (org charts, team structures)
- Meeting notes, action items, or follow-ups
- Any sales-relevant insights (objections, requirements, timelines)

Focus on information that would help a sales professional understand and use this content.`,

  document: `Extract all text and structured information from this document image. Include:
- Headers and titles
- Body text and paragraphs
- Lists and bullet points
- Tables or data structures
- Any footnotes or references
- Preserve the logical structure and hierarchy of the content`,
};

// System prompt for image classification
const CLASSIFICATION_PROMPT = `You are analyzing an image. First, classify what type of image this is:
- "screenshot": A screenshot of software, app, or website
- "document": A document, PDF, or text-heavy image
- "photo": A photograph of real-world objects or people
- "chart": A graph, chart, diagram, or data visualization
- "unknown": Cannot determine the type

Return your classification in JSON format: {"type": "screenshot", "confidence": 0.95}`;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body: ExtractRequest = await request.json();
    const { image, context, extractionType = "sales" } = body;

    if (!image) {
      return NextResponse.json(
        { error: "No image provided" },
        { status: 400 }
      );
    }

    // Determine if image is a URL or base64
    const isUrl = image.startsWith("http://") || image.startsWith("https://");
    const isBase64 = image.startsWith("data:image/");

    if (!isUrl && !isBase64) {
      return NextResponse.json(
        { error: "Image must be a URL or base64 data URL" },
        { status: 400 }
      );
    }

    // Build the image content for OpenAI
    const imageContent: { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } } = {
      type: "image_url",
      image_url: {
        url: isUrl ? image : image, // base64 data URLs work directly
        detail: "high", // Use high detail for better text extraction
      },
    };

    // Build extraction prompt with optional user context
    let extractionPrompt = EXTRACTION_PROMPTS[extractionType];
    if (context) {
      extractionPrompt = `User context: "${context}"\n\n${extractionPrompt}`;
    }

    // Call GPT-4o Vision for extraction
    console.log("[Vision] Extracting from image, type:", extractionType);
    const extractionResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: extractionPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please analyze this image and extract the relevant information.",
            },
            imageContent,
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0.3, // Lower temperature for more accurate extraction
    });

    const description = extractionResponse.choices[0]?.message?.content?.trim() || "";
    console.log("[Vision] Extraction complete, length:", description.length);

    // Call GPT-4o Vision for classification (separate call for reliability)
    console.log("[Vision] Classifying image type");
    const classificationResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: CLASSIFICATION_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Classify this image and return JSON.",
            },
            imageContent,
          ],
        },
      ],
      max_tokens: 100,
      temperature: 0.1,
    });

    // Parse classification response
    let imageType: ImageType = "unknown";
    let confidence = 0.5;

    try {
      const classificationText = classificationResponse.choices[0]?.message?.content?.trim() || "";
      // Extract JSON from response (might be wrapped in markdown)
      const jsonMatch = classificationText.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        imageType = parsed.type || "unknown";
        confidence = parsed.confidence || 0.5;
      }
    } catch {
      console.log("[Vision] Could not parse classification, using defaults");
    }

    const response: ExtractResponse = {
      description,
      metadata: {
        type: imageType,
        confidence,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[Vision] Error extracting from image:", error);
    return NextResponse.json(
      { error: "Failed to extract from image" },
      { status: 500 }
    );
  }
}
