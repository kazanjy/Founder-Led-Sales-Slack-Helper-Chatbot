import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/meeting-recorder/providers";
import { withRecorderTokenRefresh } from "@/lib/meeting-recorder/auth";
import type { MeetingCall } from "@/lib/meeting-recorder/interface";

const LOOKBACK_DAYS = 90;
const HARD_LIMIT = 250;

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "live.com", "msn.com",
]);

function normalizeDomain(d: string | null | undefined): string {
  return (d || "").trim().toLowerCase().replace(/^www\./, "").replace(/\/.*$/, "");
}

function domainFromEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 0) return null;
  return normalizeDomain(email.slice(at + 1));
}

/** Domains we consider "matches" for a deal: companyUrl + every participant
 *  email domain on the deal, minus public-provider domains. */
async function dealMatchDomains(dealId: string): Promise<Set<string>> {
  const [deal, participants] = await Promise.all([
    prisma.deal.findUnique({ where: { id: dealId }, select: { companyUrl: true } }),
    prisma.dealParticipant.findMany({ where: { dealId }, select: { email: true } }),
  ]);
  const domains = new Set<string>();
  const companyDomain = normalizeDomain(deal?.companyUrl || "");
  if (companyDomain && !PUBLIC_EMAIL_DOMAINS.has(companyDomain)) domains.add(companyDomain);
  for (const p of participants) {
    const d = domainFromEmail(p.email);
    if (d && !PUBLIC_EMAIL_DOMAINS.has(d)) domains.add(d);
  }
  return domains;
}

async function alreadyImportedCallIds(dealId: string): Promise<Set<string>> {
  const entries = await prisma.dealTimelineEntry.findMany({
    where: { dealId, type: "call_summary" },
    select: { metadata: true },
  });
  const out = new Set<string>();
  for (const e of entries) {
    if (!e.metadata) continue;
    try {
      const m = JSON.parse(e.metadata) as { providerCallId?: string };
      if (m.providerCallId) out.add(m.providerCallId);
    } catch { /* ignore */ }
  }
  return out;
}

export interface BulkImportCandidate {
  providerCallId: string;
  title: string;
  date: string;
  durationMin: number | null;
  attendees: { name: string; email?: string }[];
  matchedDomains: string[];
  status: "new" | "already_imported";
}

export interface BulkImportCandidatesResult {
  candidates: BulkImportCandidate[];
  /** ISO of the oldest call we actually fetched (or null if no calls). */
  oldestScannedDate: string | null;
  /** True if we hit the 250-call ceiling before reaching the cutoff. */
  hitCeiling: boolean;
  /** Total calls scanned in the window (matched + unmatched). */
  totalScanned: number;
  /** Provider slug ("granola" | "fathom" | "fireflies"). */
  provider: string | null;
  /** ISO of the date cutoff we used. */
  sinceCutoff: string;
}

/** Fetch up to HARD_LIMIT recent calls back to 90 days ago, filter to
 *  ones whose attendee domains intersect the deal's match domains, and
 *  flag any that are already imported. */
export async function findBulkImportCandidates(
  userId: string,
  dealId: string
): Promise<BulkImportCandidatesResult> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const sinceCutoff = since.toISOString();

  const conn = await prisma.meetingRecorderConnection.findFirst({
    where: { userId, status: "active" },
    orderBy: { lastSyncedAt: "desc" },
  });
  if (!conn) {
    return { candidates: [], oldestScannedDate: null, hitCeiling: false, totalScanned: 0, provider: null, sinceCutoff };
  }
  const provider = getProvider(conn.provider);
  if (!provider) {
    return { candidates: [], oldestScannedDate: null, hitCeiling: false, totalScanned: 0, provider: conn.provider, sinceCutoff };
  }

  let calls: MeetingCall[];
  try {
    calls = await withRecorderTokenRefresh(conn, (apiKey) =>
      provider.listCalls(apiKey, { limit: HARD_LIMIT, since })
    );
  } catch (err) {
    console.error(`[bulk-import-calls] listCalls failed for ${userId}/${dealId}:`, err);
    throw err;
  }

  const matchDomains = await dealMatchDomains(dealId);
  const importedIds = await alreadyImportedCallIds(dealId);

  const candidates: BulkImportCandidate[] = [];
  for (const call of calls) {
    const matched = new Set<string>();
    for (const a of call.attendees || []) {
      const d = domainFromEmail(a.email);
      if (d && matchDomains.has(d)) matched.add(d);
    }
    if (matched.size === 0) continue;
    candidates.push({
      providerCallId: call.id,
      title: call.title,
      date: call.date,
      durationMin: call.duration ? Math.round(call.duration / 60) : null,
      attendees: (call.attendees || []).map((a) => ({ name: a.name, email: a.email })),
      matchedDomains: Array.from(matched),
      status: importedIds.has(call.id) ? "already_imported" : "new",
    });
  }

  // Newest first for the UI
  candidates.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const oldestScannedDate = calls.length > 0
    ? calls.reduce((min, c) => (new Date(c.date).getTime() < new Date(min).getTime() ? c.date : min), calls[0].date)
    : null;

  return {
    candidates,
    oldestScannedDate,
    hitCeiling: calls.length >= HARD_LIMIT,
    totalScanned: calls.length,
    provider: conn.provider,
    sinceCutoff,
  };
}

export interface BulkImportResult {
  imported: number;
  skipped: number;
  failed: number;
  oldestImportedDate: string | null;
  newestImportedDate: string | null;
}

/** Import the selected callIds onto this deal. Dedupes against existing
 *  call_summary entries on this deal (NOT the global ProcessedRecording
 *  table) so the user can re-import a previously-deleted entry. */
export async function importSelectedCalls(
  userId: string,
  dealId: string,
  callIds: string[]
): Promise<BulkImportResult> {
  const out: BulkImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    oldestImportedDate: null,
    newestImportedDate: null,
  };

  if (callIds.length === 0) return out;

  const conn = await prisma.meetingRecorderConnection.findFirst({
    where: { userId, status: "active" },
    orderBy: { lastSyncedAt: "desc" },
  });
  if (!conn) return out;
  const provider = getProvider(conn.provider);
  if (!provider) return out;

  // Pull the 90-day list once so we have metadata for each call (title,
  // attendees, date) without re-fetching per-call.
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  let allCalls: MeetingCall[] = [];
  try {
    allCalls = await withRecorderTokenRefresh(conn, (apiKey) =>
      provider.listCalls(apiKey, { limit: HARD_LIMIT, since })
    );
  } catch (err) {
    console.error(`[bulk-import-calls] listCalls failed during import:`, err);
    return out;
  }
  const callsById = new Map(allCalls.map((c) => [c.id, c]));

  const importedIds = await alreadyImportedCallIds(dealId);
  const requestedSet = new Set(callIds);

  for (const callId of requestedSet) {
    if (importedIds.has(callId)) { out.skipped++; continue; }
    const call = callsById.get(callId);
    if (!call) { out.failed++; continue; }

    try {
      const detail = await withRecorderTokenRefresh(conn, (apiKey) =>
        provider.getCallDetail(apiKey, callId)
      );
      const content =
        (detail.summary ? `**Summary**\n${detail.summary}\n\n` : "") +
        (detail.transcript ? `**Transcript**\n${detail.transcript}` : "");
      await prisma.dealTimelineEntry.create({
        data: {
          dealId,
          type: "call_summary",
          title: call.title,
          content: content || "(no transcript)",
          sourceUrl: call.providerUrl || null,
          entryDate: new Date(call.date),
          metadata: JSON.stringify({
            bulk_imported: true,
            source: "recorder",
            provider: conn.provider,
            providerCallId: call.id,
            participants: call.participants || [],
            attendeeEmails: (call.attendees || [])
              .map((a) => a.email?.trim().toLowerCase())
              .filter((e): e is string => !!e),
          }),
        },
      });
      out.imported++;
      const callDateMs = new Date(call.date).getTime();
      if (!out.oldestImportedDate || callDateMs < new Date(out.oldestImportedDate).getTime()) {
        out.oldestImportedDate = call.date;
      }
      if (!out.newestImportedDate || callDateMs > new Date(out.newestImportedDate).getTime()) {
        out.newestImportedDate = call.date;
      }
    } catch (err) {
      console.error(`[bulk-import-calls] getCallDetail failed for ${callId}:`, err);
      out.failed++;
    }
  }

  // Back-link participants on freshly-created entries by email.
  await backlinkEntryParticipants(dealId);

  return out;
}

/** Local copy of the back-link pass from enrich.ts — kept in sync with
 *  that one. Resolves DealParticipant IDs by attendee email and writes
 *  them onto each call_summary entry's metadata so the timeline can
 *  render "With <names>". */
async function backlinkEntryParticipants(dealId: string): Promise<void> {
  const [entries, participants] = await Promise.all([
    prisma.dealTimelineEntry.findMany({
      where: { dealId, type: { in: ["call_summary", "meeting", "call_transcript"] } },
      select: { id: true, metadata: true },
    }),
    prisma.dealParticipant.findMany({
      where: { dealId },
      select: { id: true, name: true, email: true },
    }),
  ]);
  if (entries.length === 0 || participants.length === 0) return;

  const byEmail = new Map<string, string>();
  const byNameToken = new Map<string, string>();
  for (const p of participants) {
    if (p.email) byEmail.set(p.email.trim().toLowerCase(), p.id);
    const first = p.name.split(/[\s,@]/)[0]?.trim().toLowerCase();
    if (first && first.length > 1 && !byNameToken.has(first)) byNameToken.set(first, p.id);
  }

  for (const entry of entries) {
    if (!entry.metadata) continue;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(entry.metadata) as Record<string, unknown>; } catch { continue; }

    const matchedIds = new Set<string>();
    const emails = Array.isArray(parsed.attendeeEmails)
      ? (parsed.attendeeEmails as unknown[]).filter((e): e is string => typeof e === "string")
      : [];
    for (const email of emails) {
      const pid = byEmail.get(email.trim().toLowerCase());
      if (pid) matchedIds.add(pid);
    }
    if (matchedIds.size === 0 && Array.isArray(parsed.participants)) {
      for (const name of parsed.participants as unknown[]) {
        if (typeof name !== "string") continue;
        const first = name.split(/[\s,@]/)[0]?.trim().toLowerCase();
        if (!first) continue;
        const pid = byNameToken.get(first);
        if (pid) matchedIds.add(pid);
      }
    }
    if (matchedIds.size === 0) continue;

    const existingLinks = new Set<string>();
    if (Array.isArray(parsed.linkedParticipantIds)) {
      for (const id of parsed.linkedParticipantIds as unknown[]) {
        if (typeof id === "string") existingLinks.add(id);
      }
    }
    let changed = false;
    for (const id of matchedIds) {
      if (!existingLinks.has(id)) { existingLinks.add(id); changed = true; }
    }
    if (!changed) continue;

    const nextMetadata = { ...parsed, linkedParticipantIds: Array.from(existingLinks) };
    await prisma.dealTimelineEntry.update({
      where: { id: entry.id },
      data: { metadata: JSON.stringify(nextMetadata) },
    });
  }
}
