import { WebClient } from "@slack/web-api";

/**
 * Create a Slack Web API client for a specific workspace
 */
export function getSlackClient(botToken: string): WebClient {
  return new WebClient(botToken);
}

// Slack rejects chat.postMessage over 40,000 chars with msg_too_long.
// Stay comfortably under it — agent replies that quote a full call
// transcript regularly blow past the limit, and before chunking that
// meant the ENTIRE reply failed and the router fell through to the
// legacy path.
const SLACK_TEXT_LIMIT = 38_000;

/**
 * Split text into <=limit chunks, preferring newline boundaries so we
 * never cut mid-line (mid-word) unless a single line itself exceeds
 * the limit.
 */
function splitForSlack(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    // A single pathological line longer than the limit gets hard-cut.
    if (line.length > limit) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.substring(i, i + limit));
      }
      continue;
    }
    if (current.length + line.length + 1 > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Send a message to a Slack channel/thread. Messages longer than
 * Slack's per-message ceiling are split on line boundaries and posted
 * sequentially; continuation chunks thread under the first post when
 * no thread was specified, so a long transcript doesn't spam the
 * channel top-level. Returns the ts of the FIRST post (the anchor).
 */
export async function sendSlackMessage(
  client: WebClient,
  channel: string,
  text: string,
  threadTs?: string
): Promise<string | undefined> {
  const chunks = splitForSlack(text, SLACK_TEXT_LIMIT);
  let firstTs: string | undefined;
  for (const chunk of chunks) {
    const result = await client.chat.postMessage({
      channel,
      text: chunk,
      // Continuations follow the original thread, or thread under the
      // first chunk when the first post was top-level.
      thread_ts: threadTs ?? firstTs,
      // Enable rich formatting
      mrkdwn: true,
    });
    if (!firstTs) firstTs = result.ts;
  }
  return firstTs;
}

// Thread message type with file support
export interface ThreadMessage {
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  files?: Array<{
    id: string;
    name: string;
    mimetype: string;
    filetype: string;
    url_private: string;
    size: number;
  }>;
}

/**
 * Get thread messages for context
 */
export async function getThreadMessages(
  client: WebClient,
  channel: string,
  threadTs: string
): Promise<ThreadMessage[]> {
  const result = await client.conversations.replies({
    channel,
    ts: threadTs,
  });

  // Cast to our type - Slack SDK types don't include all fields
  return (result.messages || []) as ThreadMessage[];
}
