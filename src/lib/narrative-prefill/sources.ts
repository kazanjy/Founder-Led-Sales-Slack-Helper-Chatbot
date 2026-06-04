import { prisma } from "@/lib/db";

/**
 * Cached source text persisted alongside a SalesNarrativeVersion so
 * the Extend flow can reuse the original tokens. One row per
 * (versionId, type, key). Size-capped per source to keep storage
 * bounded — narratives can have 10-20 sources, ~200KB each gives
 * us a ~4MB ceiling per version.
 */

export const MAX_SOURCE_CHARS = 200_000;
export const MAX_SOURCES_PER_VERSION = 30;

export interface ExtractedSource {
  type: "url" | "pdf";
  key: string;
  content: string;
}

export async function persistNarrativeSources(opts: {
  userId: string;
  versionId: string;
  sources: ExtractedSource[];
}): Promise<void> {
  if (opts.sources.length === 0) return;
  const rows = opts.sources.slice(0, MAX_SOURCES_PER_VERSION).map((s) => {
    const content = s.content.length > MAX_SOURCE_CHARS
      ? s.content.substring(0, MAX_SOURCE_CHARS)
      : s.content;
    return {
      userId: opts.userId,
      versionId: opts.versionId,
      type: s.type === "pdf" ? "pdf" : "url",
      key: s.key,
      content,
      chars: content.length,
    };
  });
  await prisma.narrativeSource.createMany({
    data: rows,
    skipDuplicates: true,
  });
}

export async function loadNarrativeSources(opts: {
  userId: string;
  versionId: string;
}): Promise<ExtractedSource[]> {
  const rows = await prisma.narrativeSource.findMany({
    where: { versionId: opts.versionId, userId: opts.userId },
    select: { type: true, key: true, content: true },
  });
  return rows.map((r) => ({
    type: r.type === "pdf" ? "pdf" : "url",
    key: r.key,
    content: r.content,
  }));
}
