import { WebClient } from "@slack/web-api";

/**
 * Create a Slack Web API client for a specific workspace
 */
export function getSlackClient(botToken: string): WebClient {
  return new WebClient(botToken);
}

/**
 * Send a message to a Slack channel/thread
 */
export async function sendSlackMessage(
  client: WebClient,
  channel: string,
  text: string,
  threadTs?: string
): Promise<string | undefined> {
  const result = await client.chat.postMessage({
    channel,
    text,
    thread_ts: threadTs,
    // Enable rich formatting
    mrkdwn: true,
  });

  return result.ts;
}

/**
 * Get thread messages for context
 */
export async function getThreadMessages(
  client: WebClient,
  channel: string,
  threadTs: string
): Promise<Array<{ user?: string; bot_id?: string; text?: string; ts?: string }>> {
  const result = await client.conversations.replies({
    channel,
    ts: threadTs,
  });

  return result.messages || [];
}
