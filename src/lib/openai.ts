import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Truncate a string to max length at word boundary
 */
function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  // Find the last space before maxLength
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > 0) {
    return truncated.substring(0, lastSpace);
  }
  // If no space found, return the whole word (might exceed limit slightly)
  const nextSpace = text.indexOf(' ', maxLength);
  if (nextSpace > 0) {
    return text.substring(0, nextSpace);
  }
  return text;
}

/**
 * Generate a terse chat title from the first user message
 * @param firstMessage - The first user message in the conversation
 * @returns A short title (up to 40 characters, complete words only)
 */
export async function generateChatTitle(firstMessage: string): Promise<string> {
  console.log("[OpenAI] generateChatTitle called with message length:", firstMessage.length);
  console.log("[OpenAI] API key present:", !!process.env.OPENAI_API_KEY);
  console.log("[OpenAI] API key prefix:", process.env.OPENAI_API_KEY?.substring(0, 7) || "missing");

  try {
    console.log("[OpenAI] Calling chat.completions.create with model: gpt-5.2");
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content:
            "You are a chat title generator. Given a user's message, create a short, descriptive title for the conversation. The title must be under 40 characters and use complete words only - never cut off a word. Do not use quotes. Be concise and capture the essence of the question or topic.",
        },
        {
          role: "user",
          content: `Generate a short title (under 40 chars, complete words only) for this message:\n\n${firstMessage.substring(0, 500)}`,
        },
      ],
      max_completion_tokens: 50,
      temperature: 0.7,
    });

    console.log("[OpenAI] Response received:", JSON.stringify(response.choices[0]));
    const title = response.choices[0]?.message?.content?.trim() || null;
    console.log("[OpenAI] Extracted title:", title);

    // Ensure it's under 40 characters with complete words
    if (title && title.length > 40) {
      const truncated = truncateAtWordBoundary(title, 40);
      console.log("[OpenAI] Title truncated to:", truncated);
      return truncated;
    }

    return title || "New Conversation";
  } catch (error: unknown) {
    console.error("[OpenAI] Error generating chat title:", error);
    if (error instanceof Error) {
      console.error("[OpenAI] Error name:", error.name);
      console.error("[OpenAI] Error message:", error.message);
    }
    return "New Conversation";
  }
}

/**
 * Generate a one-sentence summary title for a GTM Maturity Assessment
 * @param aiRecommendations - The AI recommendations/analysis from the assessment
 * @returns A short title summarizing the GTM maturity state
 */
export async function generateAssessmentTitle(aiRecommendations: string): Promise<string> {
  console.log("[OpenAI] generateAssessmentTitle called with recommendations length:", aiRecommendations.length);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a GTM maturity summarizer. Given an AI analysis of a startup's GTM maturity assessment, create a one-sentence title (under 80 characters) that summarizes their current GTM state. Be specific and actionable. Examples: 'Early-stage with strong ICP, needs sales process', 'Scaling stage ready for first AE hire', 'Mature GTM but pricing strategy unclear'. Do not use quotes.",
        },
        {
          role: "user",
          content: `Generate a one-sentence summary title (under 80 chars) for this GTM assessment:\n\n${aiRecommendations.substring(0, 2000)}`,
        },
      ],
      max_completion_tokens: 100,
      temperature: 0.7,
    });

    const title = response.choices[0]?.message?.content?.trim() || null;
    console.log("[OpenAI] Generated assessment title:", title);

    // Ensure it's under 80 characters
    if (title && title.length > 80) {
      return title.substring(0, 77) + "...";
    }

    return title || "GTM Maturity Assessment";
  } catch (error: unknown) {
    console.error("[OpenAI] Error generating assessment title:", error);
    return "GTM Maturity Assessment";
  }
}

export { openai };
