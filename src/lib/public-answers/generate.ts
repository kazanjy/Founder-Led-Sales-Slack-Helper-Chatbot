import { sendToChatbase } from "@/lib/chatbase/client";
import {
  needsChunking,
  splitIntoChunks,
  buildChunkedHistory,
  ChatbaseMessage,
} from "@/lib/chatbase/chunking";
import { prisma } from "@/lib/db";
import { generateUniqueSlug } from "./slugify";

interface GeneratePublicAnswerInput {
  question: string;
  context?: string; // Thread context for Twitter
  source: "twitter" | "ask-mikey";
}

interface GeneratePublicAnswerResult {
  answer: string;
  preview: string;
  slug: string;
}

/**
 * Core answer generation pipeline used by both Twitter and Ask Mikey.
 *
 * Sends the question through the Chatbase API (same route as all other
 * Mikey features) to keep knowledge, tone, and behavior consistent.
 */
export async function generatePublicAnswer(
  input: GeneratePublicAnswerInput
): Promise<GeneratePublicAnswerResult> {
  const { question, context, source } = input;

  // Build the prompt
  const prompt = buildPrompt(question, source);

  // Build history from thread context if provided (and chunk if needed)
  let chatbaseHistory: ChatbaseMessage[] = [];
  if (context) {
    if (needsChunking(context)) {
      const chunks = splitIntoChunks(context);
      chatbaseHistory = buildChunkedHistory(chunks, "Thread context");
    } else {
      chatbaseHistory = [{ role: "user", content: context }];
      // Add assistant acknowledgment so the actual prompt is the final user message
      chatbaseHistory.push({
        role: "assistant",
        content:
          "I've received the thread context. I'll use it to inform my answer.",
      });
    }
  }

  // Call Chatbase — non-streaming, one-shot (no conversationId)
  const { response: answer } = await sendToChatbase(
    prompt,
    undefined,
    chatbaseHistory
  );

  // Generate preview: first sentence, truncated to 280 chars
  const preview = generatePreview(answer);

  // Generate unique slug from question text
  const slug = await generateUniqueSlug(question);

  return { answer, preview, slug };
}

/**
 * Create and store a public answer in the database.
 */
export async function createPublicAnswer(input: {
  question: string;
  context?: string;
  source: "twitter" | "ask-mikey";
  twitterTweetId?: string;
  twitterTweetUrl?: string;
  twitterHandle?: string;
  twitterThreadContext?: string;
  status?: string;
}) {
  const { answer, preview, slug } = await generatePublicAnswer({
    question: input.question,
    context: input.context,
    source: input.source,
  });

  const publicAnswer = await prisma.publicAnswer.create({
    data: {
      question: input.question,
      slug,
      answer,
      preview,
      source: input.source,
      twitterTweetId: input.twitterTweetId,
      twitterTweetUrl: input.twitterTweetUrl,
      twitterHandle: input.twitterHandle,
      twitterThreadContext: input.twitterThreadContext,
      status: input.status || "published",
    },
  });

  return publicAnswer;
}

function buildPrompt(question: string, source: string): string {
  const sourceLabel =
    source === "twitter" ? "Twitter/X" : "the Ask Mikey public Q&A";

  return `You are Mikey, an expert AI sales coach for founder-led sales. A question was submitted via ${sourceLabel}.

Answer the following question with practical, specific, actionable advice for founders doing their own sales. Be conversational but authoritative. Use concrete examples where possible. Keep the answer focused and well-structured with markdown formatting.

Question: ${question}

Provide a thorough answer (2-4 paragraphs). Do not include any preamble like "Great question!" — jump straight into the answer.`;
}

function generatePreview(answer: string): string {
  // Take the first sentence
  const firstSentence = answer.match(/^[^.!?]+[.!?]/)?.[0] || answer;

  if (firstSentence.length <= 280) {
    return firstSentence;
  }

  // Truncate at word boundary
  const truncated = firstSentence.substring(0, 277);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 200 ? truncated.substring(0, lastSpace) : truncated) + "...";
}
