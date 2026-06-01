import { prisma } from "@/lib/db";
import { getGoogleAccessToken, hasGoogleCalendarScope } from "@/lib/google";
import { getProvider } from "@/lib/meeting-recorder/providers";
import { withRecorderTokenRefresh } from "@/lib/meeting-recorder/auth";
import { enrichByEmail } from "@/lib/search/pdl";

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
  const timeMax = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Use Calendar's free-text q=<domain> as a server-side filter to
  // narrow the result set, then validate attendee domains client-side
  // in case the match was loose (mentions in description, etc.).
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "250");
  url.searchParams.set("q", opts.domain);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    console.error(`[enrich] calendar list failed for ${opts.userId}: ${res.status}`);
    return out;
  }
  const data = (await res.json()) as { items?: GCalEvent[] };
  const events = data.items ?? [];

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

    await prisma.dealTimelineEntry.create({
      data: {
        dealId: opts.dealId,
        type: "meeting",
        title: ev.summary || "Calendar meeting",
        content: body || "(no description)",
        sourceUrl: ev.htmlLink || null,
        entryDate: new Date(startIso),
        metadata: JSON.stringify({
          auto_imported: true,
          source: "calendar",
          calendarEventId: ev.id,
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

  return summary;
}
