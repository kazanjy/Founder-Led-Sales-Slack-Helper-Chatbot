import { prisma } from "@/lib/db";

export interface AttachRecapEmailInput {
  dealId: string;
  recapVersionId: string;
  title: string;
  preview: string;
  sourceUrl: string;
  entryDate: Date;
  /** Timeline entry id this recap was generated from (the call summary
   *  / transcript), if known. Lets the timeline render a "from this
   *  call" backlink later. */
  sourceEntryId?: string | null;
}

export interface AttachRecapEmailResult {
  entryId: string;
  action: "created" | "updated";
}

/**
 * Upsert a recap_email timeline entry on a deal.
 *
 * Dedupes by metadata.recapVersionId so iterating on the recap draft
 * refreshes the same row instead of stacking. Mirrors the
 * attachResearchBriefToDeal helper.
 */
export async function attachRecapEmailToDeal(input: AttachRecapEmailInput): Promise<AttachRecapEmailResult> {
  const existingEntries = await prisma.dealTimelineEntry.findMany({
    where: { dealId: input.dealId, type: "recap_email" },
    select: { id: true, metadata: true },
  });
  // Dedupe order:
  // 1. If the input carries a sourceEntryId (e.g. the call_summary
  //    timeline entry that spawned this recap), match on that first —
  //    iterating the recap creates new recap_version ids, but the
  //    user's intent is still "the recap for this call." Keeps the
  //    deal timeline from filling up with duplicate recap rows.
  // 2. Fall back to recapVersionId for non-iterative flows.
  let matchedEntryId: string | null = null;
  for (const e of existingEntries) {
    if (!e.metadata) continue;
    try {
      const m = JSON.parse(e.metadata) as { recapVersionId?: string; sourceEntryId?: string };
      if (input.sourceEntryId && m.sourceEntryId === input.sourceEntryId) {
        matchedEntryId = e.id;
        break;
      }
      if (m.recapVersionId === input.recapVersionId) {
        matchedEntryId = e.id;
        break;
      }
    } catch { /* ignore */ }
  }

  const metadata = JSON.stringify({
    source: "call_recap",
    recapVersionId: input.recapVersionId,
    ...(input.sourceEntryId ? { sourceEntryId: input.sourceEntryId } : {}),
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
      type: "recap_email",
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
