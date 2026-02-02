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

// Chatbase has an 8000 character limit per message
const CHATBASE_MESSAGE_LIMIT = 7500; // Leave buffer

/**
 * Truncate a message to fit within Chatbase's limit
 */
function truncateMessage(content: string, maxLength: number = CHATBASE_MESSAGE_LIMIT): string {
  if (content.length <= maxLength) {
    return content;
  }
  // Truncate and add indicator
  return content.substring(0, maxLength - 50) + "\n\n[Message truncated for length...]";
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
  // Truncate any history messages that exceed the limit
  const safeHistory = (history || []).map((msg) => ({
    role: msg.role,
    content: truncateMessage(msg.content),
  }));

  // Truncate current message if needed
  const safeMessage = truncateMessage(message);

  const response = await fetch("https://www.chatbase.co/api/v1/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHATBASE_API_KEY}`,
    },
    body: JSON.stringify({
      chatbotId: CHATBASE_CHATBOT_ID,
      messages: [
        ...safeHistory,
        { role: "user", content: safeMessage },
      ],
      conversationId: conversationId || undefined,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Chatbase API error:", response.status, errorText);
    console.error("Message length:", message.length, "characters");
    console.error("History length:", history?.length || 0, "messages");
    throw new Error(`Chatbase API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as ChatbaseResponse;

  return {
    response: data.text,
    conversationId: (data.conversationId as string) || conversationId,
  };
}
