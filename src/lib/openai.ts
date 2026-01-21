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
  try {
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

    const title = response.choices[0]?.message?.content?.trim() || null;

    // Ensure it's under 30 characters
    if (title && title.length > 30) {
      return title.substring(0, 27) + "...";
    }

    return title || "New Conversation";
  } catch (error) {
    console.error("Error generating chat title:", error);
    return "New Conversation";
  }
}

export { openai };
