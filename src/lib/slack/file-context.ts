/**
 * Shared helper for folding extracted file text into the message the
 * Slack agents (deal / coaching / GTM) see.
 *
 * Files attached to a Slack message used to bypass the agent routers
 * entirely — the GTM router returned false on `hasFiles` and the
 * message fell to the legacy Chatbase path, which had zero access to
 * deal / coaching / personal-data tools. So "here's the contract
 * [pdf] — how does this affect the Acme deal?" answered with a
 * generic Chatbase reply and no deal context.
 *
 * Now the handlers extract file text ONCE up front and pass it to the
 * router cascade via this helper. Each router appends it to the agent
 * message (and folds it into its detection text) so the tool-using
 * agents can actually read the file.
 */

/**
 * Append extracted file text to a user message under a clear
 * delimiter. Returns the message unchanged when there's no file
 * context. Used both for the message sent to the agent AND (joined
 * with the raw message) for deal-name / coaching-keyword detection.
 */
export function appendFileContext(message: string, fileContext?: string | null): string {
  const ctx = (fileContext || "").trim();
  if (!ctx) return message;
  if (!message.trim()) {
    // File-only message (no accompanying text) — hand the agent just
    // the attachment content with a light framing so it knows the
    // user shared a document without a specific question.
    return `The user shared the following attachment(s) with no accompanying message:\n\n${ctx}`;
  }
  return `${message}\n\n--- Attached file(s) ---\n\n${ctx}`;
}

/**
 * Build the text used for router DETECTION (deal-name substring
 * match, coaching-keyword regex). Combines the cleaned message with
 * the file text so a deal named only inside a PDF, or a coaching
 * keyword only in an attached doc, still routes correctly.
 */
export function detectionText(cleaned: string, fileContext?: string | null): string {
  const ctx = (fileContext || "").trim();
  if (!ctx) return cleaned;
  return `${cleaned}\n\n${ctx}`;
}
