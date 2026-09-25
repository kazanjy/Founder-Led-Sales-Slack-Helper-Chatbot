import { prisma } from "@/lib/db";

/**
 * The founder's discovery framework — their authored discovery
 * questions (parsed from the versioned JSON into a markdown listing)
 * and first-call checklist. Shared by every surface that audits deal
 * coverage against what the founder actually probes for: the deal
 * analyzer's Discovery Gaps section, Business Cases template/instance
 * generation, and (client-side, via the /latest endpoints) Deal Chat
 * context.
 */
export interface DiscoveryFramework {
  /** "### Category\n- question" markdown listing; "" when unauthored. */
  questionsListing: string;
  questionsVersionId: string | null;
  /** Raw checklist markdown; "" when unauthored. */
  checklist: string;
  checklistVersionId: string | null;
}

export async function loadDiscoveryFramework(userId: string): Promise<DiscoveryFramework> {
  const [dqVersion, fccVersion] = await Promise.all([
    prisma.discoveryQuestionsVersion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, content: true },
    }),
    prisma.firstCallChecklistVersion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, content: true },
    }),
  ]);

  let listing = "";
  if (dqVersion) {
    try {
      const parsed: { categories?: Array<Record<string, unknown>> } = JSON.parse(
        dqVersion.content
      );
      const lines: string[] = [];
      for (const c of parsed.categories || []) {
        const catName = (c.name || c.category || c.title) as string | undefined;
        const qs = Array.isArray(c.questions) ? c.questions : [];
        if (!qs.length) continue;
        if (catName) lines.push(`### ${catName}`);
        for (const q of qs) {
          const text =
            typeof q === "string"
              ? q
              : ((q as Record<string, string>)?.question ||
                 (q as Record<string, string>)?.text ||
                 "");
          if (text) lines.push(`- ${text}`);
        }
      }
      listing = lines.join("\n");
    } catch {
      /* malformed content — treat as unauthored */
    }
  }

  return {
    questionsListing: listing,
    questionsVersionId: listing ? dqVersion!.id : null,
    checklist: (fccVersion?.content || "").trim(),
    checklistVersionId: fccVersion?.id ?? null,
  };
}

/**
 * Render the framework as a single markdown block for prompt
 * assembly, or "" when the founder hasn't authored either asset.
 */
export function formatDiscoveryFramework(fw: DiscoveryFramework): string {
  const parts: string[] = [];
  if (fw.questionsListing) {
    parts.push(`### Discovery questions\n${fw.questionsListing}`);
  }
  if (fw.checklist) {
    parts.push(`### First-call checklist\n${fw.checklist}`);
  }
  if (parts.length === 0) return "";
  return `## Founder's Discovery Framework\n\n_The questions and checklist this founder uses to run discovery — audit coverage against THESE, not a generic checklist._\n\n${parts.join("\n\n")}`;
}
