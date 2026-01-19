/**
 * Convert standard Markdown to Slack mrkdwn format
 */
export function markdownToSlack(text: string): string {
  let result = text;

  // Convert horizontal rules (---, ***, ___) to a visual separator
  // Do this FIRST before other asterisk handling
  result = result.replace(/^[-*_]{3,}$/gm, "─────────────────────────");

  // Convert **bold** to *bold*
  result = result.replace(/\*\*([^*]+?)\*\*/g, "*$1*");

  // Convert __bold__ to *bold*
  result = result.replace(/__([^_]+?)__/g, "*$1*");

  // Convert _italic_ to _italic_ (Slack supports this natively)
  // No change needed

  // Convert headers (## Header) to *Header*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Convert [link](url) to <url|link>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

  // Convert markdown bullet points (* item) to Slack bullet (• item)
  // This prevents lone asterisks from being interpreted as bold
  result = result.replace(/^\* /gm, "• ");

  // Convert numbered lists with asterisk prefix (*1) to just number
  result = result.replace(/^\*(\d+)\)/gm, "$1)");

  // Convert inline code `code` stays the same (Slack supports it)

  // Convert code blocks ```code``` to ```code```
  // Slack supports triple backticks

  return result;
}
