import { marked } from "marked";

// Configure marked for clean HTML output
marked.setOptions({
  gfm: true, // GitHub Flavored Markdown (tables, etc.)
  breaks: false,
});

/**
 * Convert markdown to HTML using marked.
 */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown) as string;
}

/**
 * Copy rich text (HTML) and plain text to clipboard.
 * When pasted into rich text editors (Google Docs, Notion, etc.), formatting is preserved.
 * When pasted into plain text editors, falls back to plain text.
 */
export async function copyRichText(html: string, plainText: string): Promise<boolean> {
  try {
    // Modern Clipboard API with multiple formats
    if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
      const htmlBlob = new Blob([html], { type: "text/html" });
      const textBlob = new Blob([plainText], { type: "text/plain" });

      const clipboardItem = new ClipboardItem({
        "text/html": htmlBlob,
        "text/plain": textBlob,
      });

      await navigator.clipboard.write([clipboardItem]);
      return true;
    }

    // Fallback for browsers that don't support ClipboardItem
    // This only copies plain text
    await navigator.clipboard.writeText(plainText);
    return true;
  } catch (error) {
    console.error("Failed to copy to clipboard:", error);
    return false;
  }
}

/**
 * Copy text content from a DOM element as rich text.
 * Preserves the rendered HTML formatting.
 */
export async function copyElementAsRichText(element: HTMLElement): Promise<boolean> {
  const html = element.innerHTML;
  const plainText = element.innerText || element.textContent || "";
  return copyRichText(html, plainText);
}

/**
 * Copy markdown content as rich text.
 * Converts markdown to HTML and copies both formats.
 */
export async function copyMarkdownAsRichText(markdown: string): Promise<boolean> {
  const html = markdownToHtml(markdown);
  return copyRichText(html, markdown);
}

/**
 * Copy multiple chat messages as rich text.
 * Each message is wrapped with a role label and separated by horizontal rules.
 */
export async function copyMessagesAsRichText(
  messages: Array<{ role: string; content: string }>
): Promise<boolean> {
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  for (const msg of messages) {
    const roleLabel = msg.role === "USER" ? "You" : "Mikey";
    const html = markdownToHtml(msg.content);
    htmlParts.push(`<p><strong>${roleLabel}:</strong></p>${html}`);
    textParts.push(`**${roleLabel}:** ${msg.content}`);
  }

  const fullHtml = htmlParts.join("<hr style='margin: 16px 0; border: none; border-top: 1px solid #ccc;'>");
  const fullText = textParts.join("\n\n---\n\n");

  return copyRichText(fullHtml, fullText);
}
