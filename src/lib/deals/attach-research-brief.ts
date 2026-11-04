import { prisma } from "@/lib/db";

export interface AttachResearchBriefInput {
  dealId: string;
  researchId: string;
  title: string;
  preview: string;
  sourceUrl: string;
  entryDate: Date;
  calendarEventId?: string | null;
  attendeeEmails?: string[];
}

export interface AttachResearchBriefResult {
  entryId: string;
  action: "created" | "updated";
}

/**
 * Upsert a research_brief timeline entry on a deal.
 *
 * Dedupes by metadata.researchId so daily cron re-runs and manual
 * re-attaches refresh the same row instead of stacking. Shared
 * between the deal-page-button → research-page handoff flow and the
 * daily-research-briefs cron.
 */
export async function attachResearchBriefToDeal(input: AttachResearchBriefInput): Promise<AttachResearchBriefResult> {
  const existingEntries = await prisma.dealTimelineEntry.findMany({
    where: { dealId: input.dealId, type: "research_brief" },
    select: { id: true, metadata: true },
  });
  let matchedEntryId: string | null = null;
  for (const e of existingEntries) {
    if (!e.metadata) continue;
    try {
      const m = JSON.parse(e.metadata) as { researchId?: string };
      if (m.researchId === input.researchId) {
        matchedEntryId = e.id;
        break;
      }
    } catch { /* ignore */ }
  }

  const metadata = JSON.stringify({
    source: "pre_call_planning",
    researchId: input.researchId,
    ...(input.calendarEventId ? { calendarEventId: input.calendarEventId } : {}),
    ...(input.attendeeEmails && input.attendeeEmails.length > 0 ? { attendeeEmails: input.attendeeEmails } : {}),
  });

  if (matchedEntryId) {
    const updated = await prisma.dealTimelineEntry.update({
      where: { id: matchedEntryId },
      data: {
        title: input.title,
        content: input.preview,
        sourceUrl: input.sourceUrl,
        entryDate: input.entryDate,
        metadata,
      },
    });
    return { entryId: updated.id, action: "updated" };
  }

  const created = await prisma.dealTimelineEntry.create({
    data: {
      dealId: input.dealId,
      type: "research_brief",
      title: input.title,
      content: input.preview,
      sourceUrl: input.sourceUrl,
      metadata,
      entryDate: input.entryDate,
    },
  });
  await prisma.deal.update({
    where: { id: input.dealId },
    data: { updatedAt: new Date() },
  });
  return { entryId: created.id, action: "created" };
}
