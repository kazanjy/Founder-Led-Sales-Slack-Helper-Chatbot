import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/meeting-recorder/providers";
import { withRecorderTokenRefresh } from "@/lib/meeting-recorder/auth";
import type { MeetingCall } from "@/lib/meeting-recorder/interface";
import type { SourceCall } from "./generate";

/**
 * Success Stories Phase 2 — source imports.
 *
 * Two ways to fill a collection without pasting:
 *  - RECORDER: list the founder's recent recorded calls (same provider
 *    plumbing as Bulk Import Calls, but unfiltered — any call can be a
 *    success source), pull transcript + summary for the picked ones.
 *  - DEAL: pick a deal, pull its call_summary / call_transcript
 *    timeline entries. Useful mainly for POC/pilot deals and the case
 *    study's "situation / why they bought" half — closed-won alone is
 *    not a success signal (see success-stories-plan.md).
 *
 * Both dedupe against the collection's existing sources (by
 * providerCallId / entryId) so re-importing is a no-op, and both stamp
 * origin so the extraction UI can show where a call came from.
 */

const LOOKBACK_DAYS = 90;
const HARD_LIMIT = 250;

export interface RecorderCallOption {
  providerCallId: string;
  title: string;
  date: string; // ISO
  durationMin: number | null;
  attendees: string[];
  alreadyImported: boolean;
}

export interface RecorderListResult {
  provider: string | null;
  calls: RecorderCallOption[];
}

function importedProviderCallIds(sources: SourceCall[]): Set<string> {
  const out = new Set<string>();
  for (const s of sources) if (s.providerCallId) out.add(s.providerCallId);
  return out;
}

async function ownedCollection(userId: string, collectionId: string) {
  return prisma.successStoryCollection.findFirst({
    where: { id: collectionId, userId },
  });
}

async function activeRecorderConnection(userId: string) {
  return prisma.meetingRecorderConnection.findFirst({
    where: { userId, status: "active" },
    orderBy: { lastSyncedAt: "desc" },
  });
}

async function listRecentCalls(conn: NonNullable<Awaited<ReturnType<typeof activeRecorderConnection>>>): Promise<MeetingCall[]> {
  const provider = getProvider(conn.provider);
  if (!provider) return [];
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return withRecorderTokenRefresh(conn, (apiKey) =>
    provider.listCalls(apiKey, { limit: HARD_LIMIT, since })
  );
}

/** Recent recorded calls (90 days, newest first) with already-imported
 *  flags for this collection. provider null = no active connection. */
export async function listRecorderCallsForCollection(
  userId: string,
  collectionId: string
): Promise<RecorderListResult | null> {
  const collection = await ownedCollection(userId, collectionId);
  if (!collection) return null;
  const conn = await activeRecorderConnection(userId);
  if (!conn) return { provider: null, calls: [] };

  const calls = await listRecentCalls(conn);
  const imported = importedProviderCallIds(
    (collection.sources as unknown as SourceCall[]) || []
  );
  const options: RecorderCallOption[] = calls
    .map((c) => ({
      providerCallId: c.id,
      title: c.title,
      date: c.date,
      durationMin: c.duration ? Math.round(c.duration / 60) : null,
      attendees: (c.attendees || []).map((a) => a.name).filter(Boolean).slice(0, 6),
      alreadyImported: imported.has(c.id),
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return { provider: conn.provider, calls: options };
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  sources: SourceCall[];
}

/** Pull transcript + summary for the selected recorder calls and append
 *  them to the collection's sources. */
export async function importRecorderCalls(
  userId: string,
  collectionId: string,
  callIds: string[]
): Promise<ImportResult | null> {
  const collection = await ownedCollection(userId, collectionId);
  if (!collection) return null;
  const sources = [...(((collection.sources as unknown) as SourceCall[]) || [])];
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, sources };
  if (callIds.length === 0) return result;

  const conn = await activeRecorderConnection(userId);
  if (!conn) return result;
  const provider = getProvider(conn.provider);
  if (!provider) return result;

  const calls = await listRecentCalls(conn);
  const callsById = new Map(calls.map((c) => [c.id, c]));
  const imported = importedProviderCallIds(sources);

  for (const callId of new Set(callIds)) {
    if (imported.has(callId)) { result.skipped++; continue; }
    const call = callsById.get(callId);
    if (!call) { result.failed++; continue; }
    try {
      const detail = await withRecorderTokenRefresh(conn, (apiKey) =>
        provider.getCallDetail(apiKey, callId)
      );
      const content =
        (detail.summary ? `**Summary**\n${detail.summary}\n\n` : "") +
        (detail.transcript ? `**Transcript**\n${detail.transcript}` : "");
      if (!content.trim()) { result.failed++; continue; }
      sources.push({
        id: randomUUID(),
        title: call.title,
        date: call.date ? call.date.slice(0, 10) : null,
        origin: "recorder",
        providerCallId: call.id,
        content,
      });
      imported.add(callId);
      result.imported++;
    } catch (err) {
      console.error(`[success-import] getCallDetail failed for ${callId}:`, err);
      result.failed++;
    }
  }

  if (result.imported > 0) {
    await prisma.successStoryCollection.update({
      where: { id: collectionId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { sources: sources as any },
    });
  }
  return result;
}

export interface DealOption {
  id: string;
  name: string;
  companyName: string | null;
  status: string;
  callCount: number;
}

/** Deals that have at least one call entry — candidates for import. */
export async function listDealsWithCalls(userId: string): Promise<DealOption[]> {
  const deals = await prisma.deal.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      companyName: true,
      status: true,
      _count: {
        select: {
          entries: { where: { type: { in: ["call_summary", "call_transcript"] } } },
        },
      },
    },
  });
  return deals
    .filter((d) => d._count.entries > 0)
    .map((d) => ({
      id: d.id,
      name: d.name,
      companyName: d.companyName,
      status: d.status,
      callCount: d._count.entries,
    }));
}

export interface DealEntryOption {
  entryId: string;
  title: string;
  date: string | null;
  type: string;
  chars: number;
  alreadyImported: boolean;
}

/** A deal's call entries with already-imported flags for this collection. */
export async function listDealCallEntries(
  userId: string,
  collectionId: string,
  dealId: string
): Promise<DealEntryOption[] | null> {
  const collection = await ownedCollection(userId, collectionId);
  if (!collection) return null;
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, userId },
    select: { id: true },
  });
  if (!deal) return null;

  const importedEntryIds = new Set(
    (((collection.sources as unknown) as SourceCall[]) || [])
      .map((s) => s.entryId)
      .filter(Boolean)
  );
  const entries = await prisma.dealTimelineEntry.findMany({
    where: { dealId, type: { in: ["call_summary", "call_transcript"] } },
    orderBy: { entryDate: "desc" },
    take: 100,
    select: { id: true, title: true, entryDate: true, type: true, content: true },
  });
  return entries.map((e) => ({
    entryId: e.id,
    title: e.title || "Untitled call",
    date: e.entryDate ? e.entryDate.toISOString().slice(0, 10) : null,
    type: e.type,
    chars: e.content?.length || 0,
    alreadyImported: importedEntryIds.has(e.id),
  }));
}

/** Append the selected deal call entries to the collection's sources. */
export async function importDealCallEntries(
  userId: string,
  collectionId: string,
  dealId: string,
  entryIds: string[]
): Promise<ImportResult | null> {
  const collection = await ownedCollection(userId, collectionId);
  if (!collection) return null;
  const sources = [...(((collection.sources as unknown) as SourceCall[]) || [])];
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, sources };
  if (entryIds.length === 0) return result;

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, userId },
    select: { id: true },
  });
  if (!deal) return null;

  const importedEntryIds = new Set(sources.map((s) => s.entryId).filter(Boolean));
  const entries = await prisma.dealTimelineEntry.findMany({
    where: { id: { in: entryIds }, dealId },
    select: { id: true, title: true, entryDate: true, content: true },
  });
  const byId = new Map(entries.map((e) => [e.id, e]));

  for (const entryId of new Set(entryIds)) {
    if (importedEntryIds.has(entryId)) { result.skipped++; continue; }
    const entry = byId.get(entryId);
    if (!entry || !entry.content?.trim()) { result.failed++; continue; }
    sources.push({
      id: randomUUID(),
      title: entry.title || "Untitled call",
      date: entry.entryDate ? entry.entryDate.toISOString().slice(0, 10) : null,
      origin: "deal",
      entryId: entry.id,
      content: entry.content,
    });
    importedEntryIds.add(entryId);
    result.imported++;
  }

  if (result.imported > 0) {
    await prisma.successStoryCollection.update({
      where: { id: collectionId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { sources: sources as any },
    });
  }
  return result;
}
