/**
 * Extract a short product name from a full questionnaire answer.
 *
 * The "Product" question answer can be a multi-paragraph description.
 * This function pulls out just the product/company name for use in titles
 * like "Ember - First Call Checklist".
 *
 * Strategy:
 * 1. Look for "Our product is X" / "product is called X" / "X is a/an" patterns
 * 2. Fall back to the first sentence, truncated to a reasonable length
 * 3. Cap at 60 characters to keep titles readable
 */
export function extractProductName(fullAnswer: string, fallback = "Sales"): string {
  if (!fullAnswer || !fullAnswer.trim()) return fallback;

  const text = fullAnswer.trim();

  // Pattern 1: "Our product is X" / "product is X" / "product is called X"
  const productIsMatch = text.match(
    /(?:our\s+)?product\s+is\s+(?:called\s+)?([A-Z][A-Za-z0-9 ._-]*?)(?:\s*[,(.]|\s+—|\s+which|\s+that|\s+and\s|\s+is\s)/i
  );
  if (productIsMatch?.[1]) {
    const name = productIsMatch[1].trim();
    if (name.length >= 2 && name.length <= 60) return name;
  }

  // Pattern 2: "X is a/an ..." at the start of the text
  const startsWithNameMatch = text.match(
    /^([A-Z][A-Za-z0-9 ._-]*?)\s+is\s+(?:a|an|the|our)\s/i
  );
  if (startsWithNameMatch?.[1]) {
    const name = startsWithNameMatch[1].trim();
    if (name.length >= 2 && name.length <= 60) return name;
  }

  // Pattern 3: "also referred to as X" / "also known as X" / "also called X"
  const alsoKnownMatch = text.match(
    /also\s+(?:referred\s+to|known|called)\s+as\s+[""]?([A-Z][A-Za-z0-9 ._-]*?)[""]?(?:\s*[),.]|\s+and\s)/i
  );
  if (alsoKnownMatch?.[1]) {
    const name = alsoKnownMatch[1].trim();
    if (name.length >= 2 && name.length <= 60) return name;
  }

  // Pattern 4: "We are X" / "We built X" / "We created X"
  const weAreMatch = text.match(
    /(?:^|\.\s+)we\s+(?:are|built|created|developed|offer|make|provide)\s+([A-Z][A-Za-z0-9 ._-]*?)(?:\s*[,(.]|\s+—|\s+which|\s+that|\s+and\s|\s+is\s)/i
  );
  if (weAreMatch?.[1]) {
    const name = weAreMatch[1].trim();
    if (name.length >= 2 && name.length <= 60) return name;
  }

  // Fallback: use the first sentence, truncated
  const firstSentence = text.split(/[.!?\n]/)[0]?.trim() || text;
  if (firstSentence.length <= 60) return firstSentence;

  // Truncate at a word boundary near 60 chars
  const truncated = firstSentence.substring(0, 60).replace(/\s+\S*$/, "");
  return truncated || firstSentence.substring(0, 60);
}
