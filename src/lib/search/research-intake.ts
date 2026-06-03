import { openai } from "@/lib/openai";

/**
 * Fields we want to collect for a pre-call research request.
 */
export interface ResearchFields {
  companyName: string | null;
  companyDomain: string | null;
  contactName: string | null;
  contactTitle: string | null;
  contactLinkedIn: string | null;
  urls: string[];
}

/**
 * Parse freeform text (potentially across multiple turns) and extract
 * structured research fields. Uses GPT to handle any format the user throws at us.
 */
export async function parseResearchFields(freeformText: string): Promise<ResearchFields> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages: [
        {
          role: "system",
          content: `You are a text parser that extracts structured information from freeform sales research requests.

Extract these fields from the user's text:
- companyName: The company being researched
- companyDomain: The company's website domain if mentioned or clearly inferable (e.g., "acme.com")
- contactName: The person's full name
- contactTitle: The person's job title / role
- contactLinkedIn: LinkedIn profile URL if mentioned (look for linkedin.com/in/ patterns)
- urls: Any other URLs mentioned (company website, etc.) — array

Be smart about detecting:
- LinkedIn URLs like "linkedin.com/in/janedoe" or "https://www.linkedin.com/in/janedoe/"
- Company websites like "acme.com" or "https://acme.com"
- Titles embedded in context like "Jane Doe CTO" or "Jane Doe, who is their VP of Engineering"
- Company names from domains (e.g., "acme.com" → probably "Acme")

Return ONLY valid JSON. Use null for fields that cannot be determined. For urls, return an empty array if none found.`,
        },
        {
          role: "user",
          content: freeformText,
        },
      ],
      max_completion_tokens: 300,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response");

    const parsed = JSON.parse(content);

    return {
      companyName: parsed.companyName || null,
      companyDomain: parsed.companyDomain || null,
      contactName: parsed.contactName || null,
      contactTitle: parsed.contactTitle || null,
      contactLinkedIn: parsed.contactLinkedIn || null,
      urls: Array.isArray(parsed.urls) ? parsed.urls : [],
    };
  } catch (error) {
    console.error("[ResearchIntake] Parse error:", error);
    // Best-effort fallback: just return what we can
    return {
      companyName: null,
      companyDomain: null,
      contactName: null,
      contactTitle: null,
      contactLinkedIn: null,
      urls: [],
    };
  }
}

/**
 * Merge new fields into existing fields. New values override only if
 * the existing value is null/empty.
 */
export function mergeResearchFields(
  existing: ResearchFields,
  incoming: ResearchFields
): ResearchFields {
  return {
    companyName: incoming.companyName || existing.companyName,
    companyDomain: incoming.companyDomain || existing.companyDomain,
    contactName: incoming.contactName || existing.contactName,
    contactTitle: incoming.contactTitle || existing.contactTitle,
    contactLinkedIn: incoming.contactLinkedIn || existing.contactLinkedIn,
    urls: [...new Set([...existing.urls, ...incoming.urls])],
  };
}

/**
 * Identify which required/desired fields are still missing.
 */
export function getMissingFields(fields: ResearchFields): string[] {
  const missing: string[] = [];
  if (!fields.companyName) missing.push("Company Name");
  if (!fields.contactName) missing.push("Contact Name");
  if (!fields.contactTitle) missing.push("Contact Title");
  if (!fields.contactLinkedIn) missing.push("Contact LinkedIn URL");
  if (!fields.companyDomain && fields.urls.length === 0) missing.push("Company Website / Domain");
  return missing;
}

/**
 * Build a Slack message showing what we extracted and what's still needed.
 * Returns the message in Slack mrkdwn format.
 */
export function buildIntakeMessage(fields: ResearchFields, missing: string[]): string {
  const lines: string[] = [];

  lines.push("📋 *Here's what I've got so far:*\n");

  lines.push(`• *Company:* ${fields.companyName || "_not yet provided_"}`);
  lines.push(`• *Website:* ${fields.companyDomain || (fields.urls.length > 0 ? fields.urls[0] : "_not yet provided_")}`);
  lines.push(`• *Contact:* ${fields.contactName || "_not yet provided_"}`);
  lines.push(`• *Title:* ${fields.contactTitle || "_not yet provided_"}`);
  lines.push(`• *LinkedIn:* ${fields.contactLinkedIn || "_not yet provided_"}`);

  if (missing.length > 0) {
    lines.push(`\n🔍 *Still need:* ${missing.join(", ")}`);
    lines.push("\n_Reply in this thread with the missing info (just paste it in any format — LinkedIn URL, website, etc.) or type *go* to run with what we have._");
  }

  return lines.join("\n");
}

/**
 * Build the "ready to run" confirmation message.
 */
export function buildReadyMessage(fields: ResearchFields): string {
  const lines: string[] = [];

  lines.push("✅ *Got it! Here's what I'll research:*\n");

  lines.push(`• *Company:* ${fields.companyName || "Unknown"}`);
  if (fields.companyDomain) lines.push(`• *Website:* ${fields.companyDomain}`);
  lines.push(`• *Contact:* ${fields.contactName || "Not specified"}`);
  if (fields.contactTitle) lines.push(`• *Title:* ${fields.contactTitle}`);
  if (fields.contactLinkedIn) lines.push(`• *LinkedIn:* ${fields.contactLinkedIn}`);

  lines.push("\n🔍 _Running research now... This may take 30-60 seconds._");

  return lines.join("\n");
}
