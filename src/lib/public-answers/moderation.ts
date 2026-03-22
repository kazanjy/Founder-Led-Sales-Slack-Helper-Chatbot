/**
 * Moderation and spam filtering for Public Mikey intake.
 *
 * Filters out spam, non-questions, and duplicate content
 * before the answer generation pipeline runs.
 */

import { prisma } from "@/lib/db";

interface ModerationInput {
  text: string;
  authorHandle?: string;
}

interface ModerationResult {
  allowed: boolean;
  reason?: string;
}

// Words/patterns that indicate spam or non-question content
const SPAM_PATTERNS = [
  /\b(buy now|click here|limited offer|act now|free money)\b/i,
  /https?:\/\/\S+\s+https?:\/\/\S+\s+https?:\/\/\S+/i, // 3+ URLs
  /(.)\1{8,}/i, // 8+ repeated characters
  /\b(dm me|check my bio|link in bio)\b/i,
];

// Minimum question length to be worth answering
const MIN_QUESTION_LENGTH = 10;
// Maximum question length
const MAX_QUESTION_LENGTH = 2000;

/**
 * Run moderation checks on an incoming question.
 * Returns { allowed: true } if the question should be processed,
 * or { allowed: false, reason } if it should be skipped.
 */
export async function moderateQuestion(
  input: ModerationInput
): Promise<ModerationResult> {
  const { text, authorHandle } = input;

  // Strip @mentions from the text for analysis
  const cleanText = text.replace(/@\w+/g, "").trim();

  // Too short
  if (cleanText.length < MIN_QUESTION_LENGTH) {
    return { allowed: false, reason: "too_short" };
  }

  // Too long
  if (cleanText.length > MAX_QUESTION_LENGTH) {
    return { allowed: false, reason: "too_long" };
  }

  // Spam pattern match
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(cleanText)) {
      return { allowed: false, reason: "spam_pattern" };
    }
  }

  // Duplicate check — has this exact question (or very similar) been answered?
  const existingAnswer = await prisma.publicAnswer.findFirst({
    where: {
      question: { contains: cleanText.substring(0, 100), mode: "insensitive" },
      status: { not: "hidden" },
    },
    select: { slug: true },
  });

  if (existingAnswer) {
    return {
      allowed: false,
      reason: `duplicate:${existingAnswer.slug}`,
    };
  }

  return { allowed: true };
}

/**
 * Strip bot @mention from the beginning of a tweet to extract the actual question.
 */
export function extractQuestion(
  tweetText: string,
  botUsername?: string
): string {
  let text = tweetText;

  // Remove the bot's @mention (usually at the start)
  if (botUsername) {
    text = text.replace(new RegExp(`@${botUsername}\\b`, "gi"), "");
  }

  // Remove all leading @mentions (common in reply chains)
  text = text.replace(/^(@\w+\s*)+/, "");

  return text.trim();
}
