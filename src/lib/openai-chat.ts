import { openai } from "./openai";

const DIRECT_MODE_SYSTEM_PROMPT = `You are Mikey, a sharp, experienced GTM (Go-To-Market) coach for founders and early-stage sales teams. You help with sales strategy, messaging, outbound, discovery calls, objection handling, pricing, hiring, and all aspects of building a repeatable sales motion.

You are operating in Direct Mode — the user has chosen to talk to you without the Chatbase knowledge base. This means:
- You rely entirely on the conversation history and any context the user has attached (Sales Narrative, GTM Assessment, Discovery Questions, First Call Checklist, uploaded documents)
- You have access to a much larger context window, so you can work with longer documents and more detailed conversations
- You should be direct, tactical, and specific in your advice

Your style:
- Be concise and actionable. Lead with the answer, then explain if needed.
- Use concrete examples, not abstract frameworks.
- Push back when the user's approach has issues — be a coach, not a yes-man.
- When you don't have enough context, ask pointed questions to fill in the gaps.
- Format responses with markdown for readability.`;

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Stream a response from OpenAI GPT directly (no RAG, no Chatbase).
 * Sends the full conversation history + system prompt to GPT.
 *
 * @param message - The current user message
 * @param history - Previous messages in the conversation
 * @param systemPrompt - Optional custom system prompt (defaults to built-in)
 */
export async function* streamFromOpenAI(
  message: string,
  history: ChatMessage[] = [],
  systemPrompt?: string
): AsyncGenerator<string, { fullResponse: string }, unknown> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt || DIRECT_MODE_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: message },
  ];

  const stream = await openai.chat.completions.create({
    model: "gpt-5.5",
    messages,
    stream: true,
    temperature: 0.7,
  });

  let fullResponse = "";

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      fullResponse += content;
      yield content;
    }
  }

  return { fullResponse };
}
