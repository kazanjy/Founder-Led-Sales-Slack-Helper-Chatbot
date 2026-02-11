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
 * Send a message to Chatbase with streaming enabled
 * Returns an async generator that yields text chunks as they arrive
 */
export async function* streamFromChatbase(
  message: string,
  conversationId?: string,
  history?: ChatbaseMessage[]
): AsyncGenerator<string, { fullResponse: string; conversationId?: string }, unknown> {
  const safeHistory = (history || []).map((msg) => ({
    role: msg.role,
    content: truncateMessage(msg.content),
  }));

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
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Log raw chunks for debugging
      console.log("[Chatbase Stream] Raw chunk:", JSON.stringify(chunk));

      // Try different parsing strategies
      // Strategy 1: SSE format (data: {...})
      const sseLines = buffer.split("\n");
      buffer = ""; // Reset buffer, we'll add back incomplete lines

      for (let i = 0; i < sseLines.length; i++) {
        const line = sseLines[i];

        // If this is the last line and doesn't end with newline, it might be incomplete
        if (i === sseLines.length - 1 && !chunk.endsWith("\n")) {
          buffer = line;
          continue;
        }

        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            // Handle different possible response formats
            const text = parsed.text || parsed.content || parsed.delta?.content || parsed.choices?.[0]?.delta?.content;
            if (text) {
              fullResponse += text;
              yield text;
            }
            if (parsed.conversationId) {
              returnedConversationId = parsed.conversationId;
            }
          } catch {
            // Not JSON, might be raw text
            if (data && data !== "[DONE]") {
              console.log("[Chatbase Stream] Non-JSON data line:", data);
            }
          }
        } else if (line.trim() && !line.startsWith("event:") && !line.startsWith(":")) {
          // Strategy 2: Newline-delimited JSON (no "data:" prefix)
          try {
            const parsed = JSON.parse(line);
            const text = parsed.text || parsed.content || parsed.delta?.content || parsed.choices?.[0]?.delta?.content;
            if (text) {
              fullResponse += text;
              yield text;
            }
            if (parsed.conversationId) {
              returnedConversationId = parsed.conversationId;
            }
          } catch {
            // Not JSON, log for debugging
            if (line.trim()) {
              console.log("[Chatbase Stream] Unparseable line:", line);
            }
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      console.log("[Chatbase Stream] Remaining buffer:", buffer);
      try {
        const parsed = JSON.parse(buffer.startsWith("data: ") ? buffer.slice(6) : buffer);
        const text = parsed.text || parsed.content;
        if (text) {
          fullResponse += text;
          yield text;
        }
      } catch {
        // Ignore
      }
    }
  } finally {
    reader.releaseLock();
  }

  console.log("[Chatbase Stream] Complete response length:", fullResponse.length);
  return { fullResponse, conversationId: returnedConversationId };
}
