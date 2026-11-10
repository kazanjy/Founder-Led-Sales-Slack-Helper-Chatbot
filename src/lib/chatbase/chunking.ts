/**
 * Chunking utilities for Chatbase API
 *
 * Chatbase has an 8000 character limit per message.
 * This module provides utilities to split large content into chunks
 * and build conversation history that preserves all content.
 */

// Chatbase has an 8000 character limit per message
export const CHATBASE_MESSAGE_LIMIT = 7500; // Leave buffer

export interface ChatbaseMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Split text into chunks that fit within Chatbase's message limit.
 * Attempts to split at logical boundaries (headers, then lines).
 *
 * @param text - The text to split
 * @param maxLength - Maximum length per chunk (default: 7500)
 * @returns Array of text chunks
 */
export function splitIntoChunks(text: string, maxLength: number = CHATBASE_MESSAGE_LIMIT): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];

  // Try to split by markdown headers (## ) first for logical sections
  const sections = text.split(/(?=## )/);

  let currentChunk = "";
  for (const section of sections) {
    if (currentChunk.length + section.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      // If a single section is too long, split it further by lines
      if (section.length > maxLength) {
        const lines = section.split("\n");
        currentChunk = "";
        for (const line of lines) {
          if (currentChunk.length + line.length + 1 > maxLength) {
            chunks.push(currentChunk.trim());
            currentChunk = line + "\n";
          } else {
            currentChunk += line + "\n";
          }
        }
      } else {
        currentChunk = section;
      }
    } else {
      currentChunk += section;
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Split text into chunks at page boundaries (for PDFs).
 * Falls back to line-based splitting if pages are too large.
 *
 * @param text - The text to split (expects "--- Page N ---" markers)
 * @param maxLength - Maximum length per chunk (default: 7500)
 * @returns Array of text chunks
 */
export function splitByPages(text: string, maxLength: number = CHATBASE_MESSAGE_LIMIT): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];

  // Split by page markers
  const pages = text.split(/(?=--- Page \d+ ---)/);

  let currentChunk = "";
  for (const page of pages) {
    if (currentChunk.length + page.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      // If a single page is too long, split by lines
      if (page.length > maxLength) {
        const lines = page.split("\n");
        currentChunk = "";
        for (const line of lines) {
          if (currentChunk.length + line.length + 1 > maxLength) {
            if (currentChunk.trim()) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = line + "\n";
          } else {
            currentChunk += line + "\n";
          }
        }
      } else {
        currentChunk = page;
      }
    } else {
      currentChunk += page;
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Build conversation history from content chunks.
 * Each chunk becomes a user message, with assistant acknowledgments between.
 *
 * @param chunks - Array of content chunks
 * @param label - Label for the content type (e.g., "PDF", "Assessment")
 * @returns Array of ChatbaseMessages to use as conversation history
 */
export function buildChunkedHistory(
  chunks: string[],
  label: string = "Content"
): ChatbaseMessage[] {
  if (chunks.length === 0) {
    return [];
  }

  // Single chunk doesn't need the multi-part pattern
  if (chunks.length === 1) {
    return [{
      role: "user",
      content: chunks[0],
    }];
  }

  const history: ChatbaseMessage[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkLabel = `[${label} Part ${i + 1} of ${chunks.length}]\n\n`;
    history.push({
      role: "user",
      content: `${chunkLabel}${chunks[i]}`,
    });

    // Add acknowledgment from assistant (except for last chunk)
    if (i < chunks.length - 1) {
      history.push({
        role: "assistant",
        content: `I've received part ${i + 1} of the ${label.toLowerCase()}. Please continue with the remaining sections.`,
      });
    }
  }

  return history;
}

/**
 * Check if content exceeds Chatbase's limit and needs chunking.
 *
 * @param content - The content to check
 * @returns true if content needs to be chunked
 */
export function needsChunking(content: string): boolean {
  return content.length > CHATBASE_MESSAGE_LIMIT;
}
