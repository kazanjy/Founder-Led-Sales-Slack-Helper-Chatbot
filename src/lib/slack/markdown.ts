/**
 * Convert standard Markdown to Slack mrkdwn format
 */
export function markdownToSlack(text: string): string {
  let result = text;

  // Convert **bold** to *bold*
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Convert __bold__ to *bold*
  result = result.replace(/__(.+?)__/g, "*$1*");

  // Convert headers (## Header) to *Header*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Convert [link](url) to <url|link>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

  // Convert inline code `code` stays the same (Slack supports it)

  // Convert code blocks ```code``` to ```code```
  // Slack supports triple backticks

  return result;
}
