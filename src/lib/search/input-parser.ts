import { openai } from "@/lib/openai";
import type { SearchInput, ParsedSearchInput } from "./types";

/**
 * Parse freeform user input into structured search fields using GPT.
 *
 * Handles inputs like:
 * - "Acme Corp"
 * - "researching Acme Corp, meeting with Jane Doe who's their CTO"
 * - "prep for call with jane.doe@acme.com about their Series B"
 * - Structured fields passed directly
 */
export async function parseSearchInput(input: SearchInput): Promise<ParsedSearchInput> {
  // If we already have structured fields, just validate and return
  if (input.companyName && !input.freeformText) {
    return {
      companyName: input.companyName,
      contactName: input.contactName,
      contactTitle: input.contactTitle,
      contactLinkedIn: input.contactLinkedIn,
      urls: input.urls || [],
    };
  }

  // No freeform text and no company name — nothing to parse
  if (!input.freeformText && !input.companyName) {
    throw new Error("Either freeformText or companyName is required");
  }

  // Use GPT to extract structured fields from freeform text
  const freeform = input.freeformText || "";

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages: [
        {
          role: "system",
          content: `You are a text parser that extracts structured information from freeform sales research requests. Extract the following fields from the user's text:

- companyName: The company being researched (required)
- companyDomain: The company's website domain if mentioned or inferable (e.g., "acme.com")
- contactName: The specific person's name if mentioned
- contactTitle: The person's job title if mentioned
- contactLinkedIn: LinkedIn URL if mentioned
- industry: The industry if mentioned or clearly inferable
- urls: Any URLs mentioned in the text (array)
- additionalContext: Any other useful context from the text (e.g., "Series B", "competitor to X", "switching from Y")

Return ONLY valid JSON with these fields. Use null for fields that cannot be determined. For urls, return an empty array if none found.

Examples:
Input: "Acme Corp"
Output: {"companyName":"Acme Corp","companyDomain":null,"contactName":null,"contactTitle":null,"contactLinkedIn":null,"industry":null,"urls":[],"additionalContext":null}

Input: "meeting with Jane Doe, CTO at TechStart Inc, they're a Series B fintech company"
Output: {"companyName":"TechStart Inc","companyDomain":null,"contactName":"Jane Doe","contactTitle":"CTO","contactLinkedIn":null,"industry":"fintech","urls":[],"additionalContext":"Series B company"}

Input: "research https://example.com and prep for call with Bob Smith at Example Co"
Output: {"companyName":"Example Co","companyDomain":"example.com","contactName":"Bob Smith","contactTitle":null,"contactLinkedIn":null,"industry":null,"urls":["https://example.com"],"additionalContext":null}`,
        },
        {
          role: "user",
          content: freeform,
        },
      ],
      max_completion_tokens: 300,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from GPT");
    }

    const parsed = JSON.parse(content);

    // Merge with any explicitly provided fields (explicit takes priority)
    const result: ParsedSearchInput = {
      companyName: input.companyName || parsed.companyName || "Unknown Company",
      companyDomain: parsed.companyDomain || undefined,
      contactName: input.contactName || parsed.contactName || undefined,
      contactTitle: input.contactTitle || parsed.contactTitle || undefined,
      contactLinkedIn: input.contactLinkedIn || parsed.contactLinkedIn || undefined,
      industry: parsed.industry || undefined,
      urls: [...(input.urls || []), ...(parsed.urls || [])],
      additionalContext: parsed.additionalContext || undefined,
    };

    // Deduplicate URLs
    result.urls = [...new Set(result.urls)];

    return result;
  } catch (error) {
    console.error("[SearchInputParser] Error parsing input:", error);

    // Fallback: use what we have
    return {
      companyName: input.companyName || input.freeformText?.split(/[,.\s]/)[0] || "Unknown Company",
      contactName: input.contactName,
      contactTitle: input.contactTitle,
      urls: input.urls || [],
    };
  }
}
