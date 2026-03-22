import { prisma } from "@/lib/db";

/**
 * Generate an SEO-friendly slug from question text.
 *
 * - Lowercase, strip punctuation, replace spaces with hyphens
 * - Truncate to ~80 chars at a word boundary
 * - Append short random suffix if collision
 */
export function generateSlug(question: string): string {
  const slug = question
    .toLowerCase()
    .replace(/['']/g, "") // Remove apostrophes before stripping punctuation
    .replace(/[^a-z0-9\s-]/g, "") // Strip punctuation
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, ""); // Trim leading/trailing hyphens

  // Truncate to ~80 chars at a word boundary
  if (slug.length <= 80) {
    return slug;
  }

  const truncated = slug.substring(0, 80);
  const lastHyphen = truncated.lastIndexOf("-");
  return lastHyphen > 40 ? truncated.substring(0, lastHyphen) : truncated;
}

/**
 * Generate a unique slug, appending a random suffix if the base slug already exists.
 */
export async function generateUniqueSlug(question: string): Promise<string> {
  const baseSlug = generateSlug(question);

  const existing = await prisma.publicAnswer.findUnique({
    where: { slug: baseSlug },
    select: { id: true },
  });

  if (!existing) {
    return baseSlug;
  }

  // Append a short random suffix
  const suffix = Math.random().toString(36).substring(2, 5);
  return `${baseSlug}-${suffix}`;
}
