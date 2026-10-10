import { openai } from "@/lib/openai";

/**
 * Run gpt-4o vision on an image buffer to extract text + structured
 * content. Used by the narrative prefill / extend pipelines so PNGs
 * (screenshots of pricing pages, one-pagers, slides exported as
 * images) can feed the same Q&A corpus as PDFs and web pages.
 */

const EXTRACT_PROMPT = `Extract all text and structured information from this image.
Include:
- Headers and titles
- Body text and paragraphs
- Lists and bullet points
- Tables or data structures (preserve the row/column relationships)
- Any captions, footnotes, or references
- Anything sales-relevant: pricing, product features, value props, customer logos, org chart roles

Preserve the logical structure and hierarchy of the content. If the image is mostly visual (no text), describe what's shown in 2-3 sentences. Do not invent content that isn't in the image.`;

export async function extractTextFromImage(
  buffer: Buffer,
  name: string,
  mimeType: string = "image/png"
): Promise<string> {
  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: EXTRACT_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `Image filename: ${name}\n\nExtract its content.` },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
    max_tokens: 4000,
    temperature: 0.2,
  });
  return response.choices[0]?.message?.content?.trim() || "";
}
