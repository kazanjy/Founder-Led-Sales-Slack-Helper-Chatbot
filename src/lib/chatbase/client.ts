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

/**
 * Send a message to Chatbase and stream the response
 * Returns an async generator that yields text chunks
 */
export async function* streamFromChatbase(
  message: string,
  conversationId?: string,
  history?: ChatbaseMessage[]
): AsyncGenerator<string, { fullResponse: string; conversationId?: string }, unknown> {
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
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Chatbase streaming API error:", response.status, errorText);
    throw new Error(`Chatbase API error: ${response.status} - ${errorText}`);
  }

  if (!response.body) {
    throw new Error("No response body for streaming");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";
  let returnedConversationId: string | undefined = conversationId;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      // Chatbase SSE format: data: {"text": "chunk"} or similar
      // Parse SSE events
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              fullResponse += parsed.text;
              yield parsed.text;
            }
            if (parsed.conversationId) {
              returnedConversationId = parsed.conversationId;
            }
          } catch {
            // If not valid JSON, treat as raw text
            if (data.trim()) {
              fullResponse += data;
              yield data;
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { fullResponse, conversationId: returnedConversationId };
}
