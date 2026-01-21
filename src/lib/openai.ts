import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate a terse chat title from the first user message
 * @param firstMessage - The first user message in the conversation
 * @returns A short title (<30 characters)
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
            "You are a chat title generator. Given a user's message, create a very short, descriptive title for the conversation. The title must be under 30 characters. Do not use quotes. Be concise and capture the essence of the question or topic.",
        },
        {
          role: "user",
          content: `Generate a short title (<30 chars) for this message:\n\n${firstMessage.substring(0, 500)}`,
        },
      ],
      max_tokens: 30,
      temperature: 0.7,
    });

    console.log("[OpenAI] Response received:", JSON.stringify(response.choices[0]));
    const title = response.choices[0]?.message?.content?.trim() || null;
    console.log("[OpenAI] Extracted title:", title);

    // Ensure it's under 30 characters
    if (title && title.length > 30) {
      const truncated = title.substring(0, 27) + "...";
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

export { openai };
