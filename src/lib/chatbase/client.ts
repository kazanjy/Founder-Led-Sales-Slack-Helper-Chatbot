const CHATBASE_API_KEY = process.env.CHATBASE_API_KEY!;
const CHATBASE_CHATBOT_ID = process.env.CHATBASE_CHATBOT_ID!;

interface ChatbaseMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatbaseResponse {
  text: string;
  // Chatbase may include additional fields
  [key: string]: unknown;
}

/**
 * Send a message to Chatbase and get a response
 *
 * @param message - The user's message
 * @param conversationId - Optional conversation ID for context continuity
 * @param history - Optional previous messages for context
 */
export async function sendToChatbase(
  message: string,
  conversationId?: string,
  history?: ChatbaseMessage[]
): Promise<{ response: string; conversationId?: string }> {
  const response = await fetch("https://www.chatbase.co/api/v1/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHATBASE_API_KEY}`,
    },
    body: JSON.stringify({
      chatbotId: CHATBASE_CHATBOT_ID,
      messages: [
        ...(history || []),
        { role: "user", content: message },
      ],
      conversationId: conversationId || undefined,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Chatbase API error:", response.status, errorText);
    throw new Error(`Chatbase API error: ${response.status}`);
  }

  const data = (await response.json()) as ChatbaseResponse;

  return {
    response: data.text,
    conversationId: (data.conversationId as string) || conversationId,
  };
}
