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

// Timeout for non-streaming Chatbase requests (ms)
const CHATBASE_TIMEOUT_MS = 90_000; // 90 seconds

/**
 * Truncate a message to fit within Chatbase's limit
 */
function truncateMessage(content: string, maxLength: number = CHATBASE_MESSAGE_LIMIT): string {
  if (content.length <= maxLength) {
    return content;
  }
  // Log when truncation happens
  console.warn(`[Chatbase] Message truncated from ${content.length} to ${maxLength} characters (${Math.round((content.length - maxLength) / 1000)}KB lost)`);
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

  // Add timeout to prevent hanging requests
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHATBASE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("https://www.chatbase.co/api/v1/chat", {
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
      signal: controller.signal,
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (fetchError instanceof Error && fetchError.name === "AbortError") {
      throw new Error(
        "Chatbase request timed out after 90 seconds. The AI service may be overloaded. Please try again."
      );
    }
    throw fetchError;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Chatbase API error:", response.status, errorText);
    console.error("Message length:", message.length, "characters");
    console.error("History length:", history?.length || 0, "messages");
    throw new Error(`Chatbase API error: ${response.status} - ${errorText}`);
  }

  // Parse response with robust error handling — Chatbase can return truncated JSON
  let data: ChatbaseResponse;
  const responseText = await response.text();
  try {
    data = JSON.parse(responseText) as ChatbaseResponse;
  } catch (parseError) {
    console.error("Chatbase response parse error:", parseError);
    console.error("Response text length:", responseText.length);
    console.error("Response text (first 500 chars):", responseText.substring(0, 500));
    throw new Error(
      "Failed to parse Chatbase response. The AI service may have returned an incomplete response. Please try again."
    );
  }

  if (!data.text) {
    console.error("Chatbase response missing text field:", JSON.stringify(data).substring(0, 500));
    throw new Error(
      "Chatbase returned an empty response. Please try again."
    );
  }

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

      // Log raw chunks for debugging
      console.log("[Chatbase Stream] Raw chunk:", JSON.stringify(chunk));

      // Chatbase sends raw text chunks directly (not SSE format)
      // Just yield the chunk as-is
      if (chunk) {
        fullResponse += chunk;
        yield chunk;
      }
    }
  } finally {
    reader.releaseLock();
  }

  console.log("[Chatbase Stream] Complete response length:", fullResponse.length);
  return { fullResponse, conversationId: returnedConversationId };
}
