import { prisma } from "@/lib/db";
import { getGoogleAccessToken, hasGoogleCalendarScope } from "@/lib/google";
import { getProvider } from "@/lib/meeting-recorder/providers";
import { withRecorderTokenRefresh } from "@/lib/meeting-recorder/auth";
import { enrichByEmail } from "@/lib/search/pdl";
import { suggestDealNameFromCalls } from "@/lib/deals/suggest-name";

/**
 * Hydrate a freshly-validated deal with everything we can find about
 * the prospect across the user's connected sources:
 *
 *   - last 30 days of Google Calendar events with attendees at the
 *     deal's domain → "meeting" timeline entries
 *   - recent recorder calls (latest 50) with attendees at the domain
 *     → "call_summary" timeline entries (with transcript)
 *   - every external attendee across both → DealParticipants,
 *     PDL-enriched by email
 *
 * Idempotent. Re-running on the same deal is safe — entries are
 * deduped by event/call ID in metadata, participants by email.
 */

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "live.com", "msn.com",
]);

const CALENDAR_LOOKBACK_DAYS = 30;
const CALENDAR_LOOKAHEAD_DAYS = 90;
const RECORDER_CALL_LIMIT = 50;
const PDL_REENRICH_DAYS = 30;

function normalizeDomain(d: string | null | undefined): string {
  return (d || "").trim().toLowerCase().replace(/^www\./, "").replace(/\/.*$/, "");
}
function domainFromEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = normalizeDomain(email.slice(at + 1));
  return d || null;
}

interface GCalAttendee {
  email?: string;
  displayName?: string;
  self?: boolean;
}
interface GCalEvent {
  id: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: GCalAttendee[];
}

export interface EnrichDealSummary {
  dealDomain: string | null;
  calendarEvents: { scanned: number; added: number; skipped: number };
  recorderCalls: { scanned: number; added: number; skipped: number };
  participants: { upserted: number; enriched: number };
  errors: number;
}

function dealDomainFor(deal: { companyUrl: string | null }): string | null {
  if (!deal.companyUrl) return null;
  const stripped = deal.companyUrl.replace(/^https?:\/\//i, "");
  return normalizeDomain(stripped) || null;
}

async function existingEventIds(dealId: string): Promise<Set<string>> {
  const entries = await prisma.dealTimelineEntry.findMany({
    where: { dealId, type: "meeting" },
    select: { metadata: true },
  });
  const out = new Set<string>();
  for (const e of entries) {
    if (!e.metadata) continue;
    try {
      const m = JSON.parse(e.metadata) as { calendarEventId?: string };
      if (m.calendarEventId) out.add(m.calendarEventId);
    } catch { /* ignore */ }
  }
  return out;
}

async function existingCallIds(dealId: string): Promise<Set<string>> {
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

async function enrichCalendar(opts: {
  userId: string;
  dealId: string;
  domain: string;
  participantBucket: Map<string, { name: string; email: string }>;
}): Promise<EnrichDealSummary["calendarEvents"]> {
  const out = { scanned: 0, added: 0, skipped: 0 };

  const tokenRow = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { googleRefreshToken: true, googleScopes: true },
  });
  if (!tokenRow?.googleRefreshToken || !hasGoogleCalendarScope(tokenRow.googleScopes)) {
    return out;
  }
  const accessToken = await getGoogleAccessToken(opts.userId);
  if (!accessToken) return out;

  const timeMin = new Date(Date.now() - CALENDAR_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const timeMax = new Date(Date.now() + CALENDAR_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  // We used to send q=<domain> as a server-side filter to narrow the
  // result set, but Google Calendar's free-text search tokenizes on
  // `.` (so a search for "glyf.space" can miss events where the
  // domain only appears inside an attendee email). Now we fetch the
  // raw window and rely entirely on attendee-domain matching below.
  // Paginates via nextPageToken so a busy calendar past the
  // 250-results cap still gets fully scanned.
  const events: GCalEvent[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", timeMin.toISOString());
    url.searchParams.set("timeMax", timeMax.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.error(`[enrich] calendar list failed for ${opts.userId}: ${res.status}`);
      return out;
    }
    const data = (await res.json()) as { items?: GCalEvent[]; nextPageToken?: string };
    if (Array.isArray(data.items)) events.push(...data.items);
    pageToken = data.nextPageToken;
    // Hard cap to avoid runaway pagination on enormous calendars.
    if (events.length >= 1500) break;
  } while (pageToken);

  const seenEventIds = await existingEventIds(opts.dealId);

  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    out.scanned++;
    const hasMatch = (ev.attendees || []).some((a) => {
      const d = domainFromEmail(a.email);
      return d === opts.domain;
    });
    if (!hasMatch) continue;
    if (seenEventIds.has(ev.id)) {
      out.skipped++;
      continue;
    }
    const startIso = ev.start?.dateTime || ev.start?.date || new Date().toISOString();

    // Collect attendees for participant enrichment.
    for (const a of ev.attendees || []) {
      const d = domainFromEmail(a.email);
      if (!d || d !== opts.domain) continue;
      if (a.email && !opts.participantBucket.has(a.email.toLowerCase())) {
        opts.participantBucket.set(a.email.toLowerCase(), {
          name: a.displayName || a.email,
          email: a.email,
        });
      }
    }

    const attendeeLine = (ev.attendees || [])
      .filter((a) => domainFromEmail(a.email) === opts.domain)
      .map((a) => (a.displayName ? `${a.displayName} <${a.email}>` : a.email))
      .filter(Boolean)
      .join(", ");
    const body =
      (ev.description ? `${ev.description.trim()}\n\n` : "") +
      (attendeeLine ? `**Attendees from ${opts.domain}:** ${attendeeLine}` : "");

    const startDate = new Date(startIso);
    const isUpcoming = startDate.getTime() > Date.now();
    await prisma.dealTimelineEntry.create({
      data: {
        dealId: opts.dealId,
        type: "meeting",
        title: ev.summary || "Calendar meeting",
        content: body || "(no description)",
        sourceUrl: ev.htmlLink || null,
        entryDate: startDate,
        metadata: JSON.stringify({
          auto_imported: true,
          source: "calendar",
          calendarEventId: ev.id,
          // Snapshot whether this was a future meeting at import time
          // so re-runs after the date passes don't churn the flag.
          // UI / analyzer still compare entryDate vs now() as the
          // source of truth — this is just for telemetry.
          futureAtImport: isUpcoming,
          attendeeEmails: (ev.attendees || [])
            .map((a) => a.email?.trim().toLowerCase())
            .filter((e): e is string => !!e),
        }),
      },
    });
    out.added++;
  }
  return out;
}

async function enrichRecorder(opts: {
  userId: string;
  dealId: string;
  domain: string;
  participantBucket: Map<string, { name: string; email: string }>;
}): Promise<EnrichDealSummary["recorderCalls"]> {
  const out = { scanned: 0, added: 0, skipped: 0 };

  const conn = await prisma.meetingRecorderConnection.findFirst({
    where: { userId: opts.userId, status: "active" },
    orderBy: { lastSyncedAt: "desc" },
  });
  if (!conn) return out;
  const provider = getProvider(conn.provider);
  if (!provider) return out;

  let calls;
  try {
    calls = await withRecorderTokenRefresh(conn, (apiKey) =>
      provider.listCalls(apiKey, RECORDER_CALL_LIMIT)
    );
  } catch (err) {
    console.error(`[enrich] recorder listCalls failed for ${opts.userId}:`, err);
    return out;
  }
  out.scanned = calls.length;

  const seenCallIds = await existingCallIds(opts.dealId);

  for (const call of calls) {
    const hasMatch = (call.attendees || []).some((a) => domainFromEmail(a.email) === opts.domain);
    if (!hasMatch) continue;
    if (seenCallIds.has(call.id)) {
      out.skipped++;
      continue;
    }

    for (const a of call.attendees || []) {
      const d = domainFromEmail(a.email);
      if (!d || d !== opts.domain) continue;
      if (a.email && !opts.participantBucket.has(a.email.toLowerCase())) {
        opts.participantBucket.set(a.email.toLowerCase(), {
          name: a.name || a.email,
          email: a.email,
        });
      }
    }

    try {
      const detail = await withRecorderTokenRefresh(conn, (apiKey) =>
        provider.getCallDetail(apiKey, call.id)
      );
      const content =
        (detail.summary ? `**Summary**\n${detail.summary}\n\n` : "") +
        (detail.transcript ? `**Transcript**\n${detail.transcript}` : "");
      await prisma.dealTimelineEntry.create({
        data: {
          dealId: opts.dealId,
          type: "call_summary",
          title: call.title,
          content: content || "(no transcript)",
          sourceUrl: call.providerUrl || null,
          entryDate: new Date(call.date),
          metadata: JSON.stringify({
            auto_imported: true,
            source: "recorder",
            provider: conn.provider,
            providerCallId: call.id,
            participants: call.participants || [],
            // Captured so the post-enrich back-link pass can resolve
            // each attendee to a DealParticipant row by email and
            // populate linkedParticipantIds for the "With <names>"
            // row on the timeline entry.
            attendeeEmails: (call.attendees || [])
              .map((a) => a.email?.trim().toLowerCase())
              .filter((e): e is string => !!e),
          }),
        },
      });
      out.added++;
    } catch (err) {
      console.error(`[enrich] getCallDetail failed for ${call.id}:`, err);
    }
  }

  return out;
}

async function enrichParticipants(opts: {
  dealId: string;
  participants: Map<string, { name: string; email: string }>;
}): Promise<EnrichDealSummary["participants"]> {
  const out = { upserted: 0, enriched: 0 };

  const existing = await prisma.dealParticipant.findMany({
    where: { dealId: opts.dealId },
    select: { id: true, email: true, pdlEnrichedAt: true },
  });
  const existingByEmail = new Map<string, (typeof existing)[number]>();
  for (const p of existing) {
    if (p.email) existingByEmail.set(p.email.toLowerCase(), p);
  }

  for (const [emailLower, info] of opts.participants) {
    const enriched = await enrichByEmail(info.email);
    let pdlData: string | null = null;
    if (enriched) {
      pdlData = JSON.stringify(enriched);
      out.enriched++;
    }

    const existingRow = existingByEmail.get(emailLower);
    if (existingRow) {
      // Only refresh PDL if stale or missing.
      const stale =
        !existingRow.pdlEnrichedAt ||
        Date.now() - existingRow.pdlEnrichedAt.getTime() > PDL_REENRICH_DAYS * 24 * 60 * 60 * 1000;
      if (enriched && stale) {
        await prisma.dealParticipant.update({
          where: { id: existingRow.id },
          data: {
            name: enriched.fullName || info.name,
            title: enriched.title || undefined,
            company: enriched.company || undefined,
            linkedinUrl: enriched.linkedinUrl || undefined,
            pdlData,
            pdlEnrichedAt: new Date(),
          },
        });
      }
      continue;
    }

    await prisma.dealParticipant.create({
      data: {
        dealId: opts.dealId,
        name: enriched?.fullName || info.name,
        email: info.email,
        title: enriched?.title || undefined,
        company: enriched?.company || undefined,
        linkedinUrl: enriched?.linkedinUrl || undefined,
        pdlData,
        pdlEnrichedAt: enriched ? new Date() : null,
      },
    });
    out.upserted++;
  }

  return out;
}

export async function enrichDeal(userId: string, dealId: string): Promise<EnrichDealSummary> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, userId: true, companyUrl: true, companyName: true },
  });
  if (!deal || deal.userId !== userId) {
    throw new Error("Deal not found or not owned by user");
  }

  const domain = dealDomainFor(deal);
  const summary: EnrichDealSummary = {
    dealDomain: domain,
    calendarEvents: { scanned: 0, added: 0, skipped: 0 },
    recorderCalls: { scanned: 0, added: 0, skipped: 0 },
    participants: { upserted: 0, enriched: 0 },
    errors: 0,
  };

  if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) {
    console.warn(`[enrich] deal ${dealId} has no usable domain (${domain ?? "null"}) — skipping`);
    return summary;
  }

  // Shared map so the same person seen in both calendar and recorder
  // only triggers one PDL call.
  const participantBucket = new Map<string, { name: string; email: string }>();

  try {
    summary.calendarEvents = await enrichCalendar({
      userId,
      dealId,
      domain,
      participantBucket,
    });
  } catch (err) {
    console.error(`[enrich] calendar pass failed for ${dealId}:`, err);
    summary.errors++;
  }

  try {
    summary.recorderCalls = await enrichRecorder({
      userId,
      dealId,
      domain,
      participantBucket,
    });
  } catch (err) {
    console.error(`[enrich] recorder pass failed for ${dealId}:`, err);
    summary.errors++;
  }

  // Always also include any existing participants so PDL can backfill
  // ones the recorder scanner created without titles.
  const existing = await prisma.dealParticipant.findMany({
    where: { dealId, email: { not: null } },
    select: { name: true, email: true },
  });
  for (const p of existing) {
    if (!p.email) continue;
    const lower = p.email.toLowerCase();
    if (!participantBucket.has(lower)) {
      participantBucket.set(lower, { name: p.name, email: p.email });
    }
  }

  try {
    summary.participants = await enrichParticipants({
      dealId,
      participants: participantBucket,
    });
  } catch (err) {
    console.error(`[enrich] participants pass failed for ${dealId}:`, err);
    summary.errors++;
  }

  // Back-link DealParticipants to the timeline entries they appeared
  // in. Has to run after the participants pass since the IDs only
  // exist post-create. Additive — never strips a manually-linked id.
  try {
    await backlinkEntryParticipants(dealId);
  } catch (err) {
    console.error(`[enrich] back-link pass failed for ${dealId}:`, err);
    summary.errors++;
  }

  try {
    await renamePlaceholderDeal(dealId, deal.companyName);
  } catch (err) {
    console.error(`[enrich] rename pass failed for ${dealId}:`, err);
    summary.errors++;
  }

  return summary;
}

/**
 * If the deal's name still matches the "{Company} — Potential"
 * placeholder that auto-detect set when the row was spawned, hand
 * the freshly-imported timeline + participants to the suggest-name
 * LLM and replace the name with a proper opportunity descriptor.
 * User-edited names (anything that doesn't match the placeholder
 * pattern) are left alone.
 */
async function renamePlaceholderDeal(dealId: string, companyName: string): Promise<void> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { name: true },
  });
  if (!deal) return;

  // Placeholder format from auto-detect.ts: "<companyName> — Potential".
  // Also tolerate "— New Business" since that's the LLM's own fallback,
  // and the bare companyName which a few legacy rows have.
  const trimmed = deal.name.trim();
  const lowerCompany = companyName.toLowerCase();
  const lowerName = trimmed.toLowerCase();
  const looksPlaceholder =
    lowerName === lowerCompany ||
    lowerName === `${lowerCompany} — potential` ||
    lowerName === `${lowerCompany} - potential` ||
    lowerName === `${lowerCompany} — new business` ||
    lowerName === `${lowerCompany} - new business`;
  if (!looksPlaceholder) return;

  // Pull the entries we just hydrated. Reuse the suggest-name shape:
  // recorder calls (transcript + summary), calendar meetings (treated
  // as call-shaped), plus current participants for context.
  const [entries, participants] = await Promise.all([
    prisma.dealTimelineEntry.findMany({
      where: {
        dealId,
        type: { in: ["call_summary", "meeting", "call_transcript"] },
      },
      orderBy: { entryDate: "desc" },
      take: 6,
      select: { title: true, content: true, entryDate: true },
    }),
    prisma.dealParticipant.findMany({
      where: { dealId },
      select: { name: true, email: true, title: true, company: true },
    }),
  ]);

  if (entries.length === 0) return;

  const callShaped = entries.map((e) => ({
    title: e.title || undefined,
    date: e.entryDate.toISOString(),
    summary: e.content,
    attendees: participants.map((p) => ({
      name: p.name,
      email: p.email || undefined,
      title: p.title || undefined,
      company: p.company || undefined,
    })),
  }));

  const suggestion = await suggestDealNameFromCalls(callShaped);
  if (!suggestion.dealName) return;
  // Defensive: don't accept a name that's just the placeholder again,
  // and don't accept a name that doesn't reference the company.
  const lowerSuggestion = suggestion.dealName.toLowerCase();
  if (lowerSuggestion.endsWith("— potential") || lowerSuggestion.endsWith("- potential")) return;
  if (!lowerSuggestion.includes(lowerCompany.split(/[\s.]/)[0])) {
    // Suggestion didn't anchor to the prospect — skip to avoid weird renames.
    return;
  }

  await prisma.deal.update({
    where: { id: dealId },
    data: { name: suggestion.dealName },
  });
}

/**
 * Walk every call_summary / meeting timeline entry on the deal, resolve
 * the attendee emails stored in metadata to DealParticipant ids, and
 * write the union into metadata.linkedParticipantIds so the "With
 * <names>" row on each entry actually renders the people. Additive —
 * existing linkedParticipantIds (e.g. ones a user manually attached via
 * the inline picker) are preserved.
 *
 * Also handles legacy entries that don't carry attendeeEmails — falls
 * back to a name-token match against participant.name as a best effort.
 */
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
  const byNameToken = new Map<string, string>(); // first token of name → participant id (best effort)
  for (const p of participants) {
    if (p.email) byEmail.set(p.email.trim().toLowerCase(), p.id);
    const first = p.name.split(/[\s,@]/)[0]?.trim().toLowerCase();
    if (first && first.length > 1 && !byNameToken.has(first)) {
      byNameToken.set(first, p.id);
    }
  }

  for (const entry of entries) {
    if (!entry.metadata) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(entry.metadata) as Record<string, unknown>;
    } catch {
      continue;
    }

    const matchedIds = new Set<string>();
    const emails = Array.isArray(parsed.attendeeEmails)
      ? (parsed.attendeeEmails as unknown[]).filter((e): e is string => typeof e === "string")
      : [];
    for (const email of emails) {
      const pid = byEmail.get(email.trim().toLowerCase());
      if (pid) matchedIds.add(pid);
    }

    // Legacy fallback: entries written before attendeeEmails was added
    // only have a list of bare name strings. Match the first token.
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

    // Union with any existing linkedParticipantIds (e.g. ones the user
    // attached manually). Skip the write if nothing would change.
    const existingLinks = new Set<string>();
    if (Array.isArray(parsed.linkedParticipantIds)) {
      for (const id of parsed.linkedParticipantIds as unknown[]) {
        if (typeof id === "string") existingLinks.add(id);
      }
    }
    let changed = false;
    for (const id of matchedIds) {
      if (!existingLinks.has(id)) {
        existingLinks.add(id);
        changed = true;
      }
    }
    if (!changed) continue;

    const nextMetadata = { ...parsed, linkedParticipantIds: Array.from(existingLinks) };
    await prisma.dealTimelineEntry.update({
      where: { id: entry.id },
      data: { metadata: JSON.stringify(nextMetadata) },
    });
  }
}
