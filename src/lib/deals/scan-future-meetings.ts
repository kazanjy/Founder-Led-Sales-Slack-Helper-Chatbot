import { prisma } from "@/lib/db";
import { getGoogleAccessToken, hasGoogleCalendarScope } from "@/lib/google";
import { decodeHtmlEntities } from "@/lib/html-entities";

/**
 * Calendar-only forward scan. Reuses the matching logic from
 * enrichCalendar (in enrich.ts) but skips the recorder + PDL passes
 * so the click-to-refresh round-trip is fast. The sweep variant
 * fetches the calendar ONCE and buckets events across every eligible
 * deal so we don't re-pull the same window N times.
 */

const CALENDAR_LOOKAHEAD_DAYS = 90;

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "live.com", "msn.com",
]);

// Deal STATUSES still in play for the cross-deal sweep. This used to
// be a stage filter with values that mostly don't exist in this app's
// stage vocabulary ("qualified", "verbal_yes") — which silently
// skipped deals in prospecting/demo/closing. Status is the field that
// actually means "in play": closed_won / closed_lost / dismissed
// don't get future-meeting updates; stalled DOES (a new meeting on a
// stalled deal is exactly the signal worth catching).
const IN_PLAY_STATUSES = new Set(["active", "potential", "likely", "stalled"]);

interface GCalAttendee { email?: string; displayName?: string }
interface GCalEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: GCalAttendee[];
  // Present on instances of a recurring series (we fetch with
  // singleEvents=true). A strong existing-relationship signal for the
  // autopilot triage: weekly check-ins are customers, not pipeline.
  recurringEventId?: string;
}

function normalizeDomain(d: string | null | undefined): string {
  return (d || "").trim().toLowerCase().replace(/^www\./, "").replace(/\/.*$/, "");
}
function domainFromEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 0) return null;
  return normalizeDomain(email.slice(at + 1));
}

async function fetchCalendarWindow(userId: string): Promise<GCalEvent[] | null> {
  const tokenRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleRefreshToken: true, googleScopes: true },
  });
  if (!tokenRow?.googleRefreshToken || !hasGoogleCalendarScope(tokenRow.googleScopes)) {
    return null;
  }
  const accessToken = await getGoogleAccessToken(userId);
  if (!accessToken) return null;

  const timeMin = new Date(); // now — future only
  const timeMax = new Date(Date.now() + CALENDAR_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

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
      console.error(`[scan-future-meetings] calendar list failed for ${userId}: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { items?: GCalEvent[]; nextPageToken?: string };
    if (Array.isArray(data.items)) events.push(...data.items);
    pageToken = data.nextPageToken;
    if (events.length >= 1500) break;
  } while (pageToken);
  return events;
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

async function createMeetingEntry(
  dealId: string,
  ev: GCalEvent,
  matchedDomains: Set<string>
): Promise<void> {
  const startIso = ev.start?.dateTime || ev.start?.date || new Date().toISOString();
  const startDate = new Date(startIso);
  const attendeeLines = (ev.attendees || [])
    .filter((a) => {
      const d = domainFromEmail(a.email);
      return d && matchedDomains.has(d);
    })
    .map((a) => (a.displayName ? `${a.displayName} <${a.email}>` : a.email))
    .filter(Boolean)
    .join(", ");
  const body =
    (ev.description ? `${decodeHtmlEntities(ev.description.trim())}\n\n` : "") +
    (attendeeLines ? `**Attendees from ${Array.from(matchedDomains).join(", ")}:** ${attendeeLines}` : "");

  await prisma.dealTimelineEntry.create({
    data: {
      dealId,
      type: "meeting",
      title: ev.summary || "Calendar meeting",
      content: body || "(no description)",
      sourceUrl: ev.htmlLink || null,
      entryDate: startDate,
      metadata: JSON.stringify({
        auto_imported: true,
        source: "calendar",
        calendarEventId: ev.id,
        futureAtImport: true,
        attendeeEmails: (ev.attendees || [])
          .map((a) => a.email?.trim().toLowerCase())
          .filter((e): e is string => !!e),
      }),
    },
  });
}

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

export interface ScanFutureMeetingsDealResult {
  scanned: number;
  added: number;
  skipped: number;
  hasCalendar: boolean;
  hasDomain: boolean;
}

export async function scanFutureMeetingsForDeal(
  userId: string,
  dealId: string
): Promise<ScanFutureMeetingsDealResult> {
  const out: ScanFutureMeetingsDealResult = {
    scanned: 0, added: 0, skipped: 0, hasCalendar: true, hasDomain: true,
  };

  const events = await fetchCalendarWindow(userId);
  if (events === null) { out.hasCalendar = false; return out; }

  const domains = await dealMatchDomains(dealId);
  if (domains.size === 0) { out.hasDomain = false; return out; }

  const seenEventIds = await existingEventIds(dealId);

  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    out.scanned++;
    const matched = new Set<string>();
    for (const a of ev.attendees || []) {
      const d = domainFromEmail(a.email);
      if (d && domains.has(d)) matched.add(d);
    }
    if (matched.size === 0) continue;
    if (seenEventIds.has(ev.id)) { out.skipped++; continue; }
    try {
      await createMeetingEntry(dealId, ev, matched);
      out.added++;
    } catch (err) {
      console.error(`[scan-future-meetings] create entry failed (${dealId}, ${ev.id}):`, err);
    }
  }

  if (out.added > 0) await backlinkEntryParticipants(dealId);
  return out;
}

export interface UnmatchedCalendarEvent {
  calendarEventId: string;
  title: string;
  description: string;
  startsAt: string;
  htmlLink: string | null;
  attendees: Array<{ email: string; name: string | null }>;
  /** Instance of a recurring series — reads as an ongoing relationship
   *  (customer/implementation cadence), not a fresh sales cycle. */
  isRecurring: boolean;
  /** How many events in the next-90-day window share this event's
   *  external attendee domain(s) — several future meetings already on
   *  the books is the same ongoing-relationship signal. */
  futureMeetingsWithSameAccount: number;
}

export interface ScanFutureMeetingsUserResult {
  hasCalendar: boolean;
  dealsScanned: number;
  totalEventsAdded: number;
  perDeal: Array<{ dealId: string; dealName: string; added: number; skipped: number }>;
  /** Events with external attendees that matched NO deal — the deal
   *  autopilot's triage candidates (deal-autopilot-plan.md). */
  unmatchedEvents: UnmatchedCalendarEvent[];
}

export async function scanFutureMeetingsForUser(
  userId: string
): Promise<ScanFutureMeetingsUserResult> {
  const out: ScanFutureMeetingsUserResult = {
    hasCalendar: true,
    dealsScanned: 0,
    totalEventsAdded: 0,
    perDeal: [],
    unmatchedEvents: [],
  };

  const events = await fetchCalendarWindow(userId);
  if (events === null) { out.hasCalendar = false; return out; }

  // Build domain → dealIds index across every active deal we own. A
  // single event can match multiple deals (rare — overlapping prospects
  // in one meeting) so we accept N matches and write one entry each.
  const deals = await prisma.deal.findMany({
    where: { userId, status: { in: Array.from(IN_PLAY_STATUSES) } },
    select: { id: true, name: true, companyUrl: true },
  });
  const participants = deals.length > 0
    ? await prisma.dealParticipant.findMany({
        where: { dealId: { in: deals.map((d) => d.id) } },
        select: { dealId: true, email: true },
      })
    : [];
  const participantsByDeal = new Map<string, string[]>();
  for (const p of participants) {
    const d = domainFromEmail(p.email);
    if (!d || PUBLIC_EMAIL_DOMAINS.has(d)) continue;
    const arr = participantsByDeal.get(p.dealId) || [];
    arr.push(d);
    participantsByDeal.set(p.dealId, arr);
  }

  const domainToDealIds = new Map<string, Set<string>>();
  const dealDomains = new Map<string, Set<string>>(); // dealId → domains
  for (const deal of deals) {
    const domains = new Set<string>();
    const companyDomain = normalizeDomain(deal.companyUrl || "");
    if (companyDomain && !PUBLIC_EMAIL_DOMAINS.has(companyDomain)) domains.add(companyDomain);
    for (const d of participantsByDeal.get(deal.id) || []) domains.add(d);
    if (domains.size === 0) continue;
    dealDomains.set(deal.id, domains);
    for (const d of domains) {
      const set = domainToDealIds.get(d) || new Set();
      set.add(deal.id);
      domainToDealIds.set(d, set);
    }
  }

  // NOTE: even with zero deal domains we keep going far enough to
  // collect unmatched external events — a founder with no deals yet is
  // exactly who the autopilot should be detecting first calls for.

  // Existing event-ids per deal so we dedupe correctly when one event
  // qualifies for multiple deals.
  const allEntries = await prisma.dealTimelineEntry.findMany({
    where: { dealId: { in: Array.from(dealDomains.keys()) }, type: "meeting" },
    select: { dealId: true, metadata: true },
  });
  const seenByDeal = new Map<string, Set<string>>();
  for (const e of allEntries) {
    if (!e.metadata) continue;
    try {
      const m = JSON.parse(e.metadata) as { calendarEventId?: string };
      if (!m.calendarEventId) continue;
      const set = seenByDeal.get(e.dealId) || new Set<string>();
      set.add(m.calendarEventId);
      seenByDeal.set(e.dealId, set);
    } catch { /* ignore */ }
  }

  const addedByDeal = new Map<string, number>();
  const skippedByDeal = new Map<string, number>();
  const dealsTouched = new Set<string>();

  // Per-domain event counts across the whole 90-day window — the
  // "how many future meetings do we already have with this account"
  // signal for the triage classifier. singleEvents=true means a
  // weekly series contributes one event per instance, which is
  // exactly the ongoing-cadence signal we want.
  const domainEventCounts = new Map<string, number>();
  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    const evDomains = new Set<string>();
    for (const a of ev.attendees || []) {
      const d = domainFromEmail(a.email);
      if (d && !PUBLIC_EMAIL_DOMAINS.has(d)) evDomains.add(d);
    }
    for (const d of evDomains) {
      domainEventCounts.set(d, (domainEventCounts.get(d) || 0) + 1);
    }
  }

  const MAX_UNMATCHED = 25;
  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    const matchedDealsAndDomains = new Map<string, Set<string>>(); // dealId → matched domains
    let hasExternalAttendee = false;
    for (const a of ev.attendees || []) {
      const d = domainFromEmail(a.email);
      if (!d) continue;
      if (!PUBLIC_EMAIL_DOMAINS.has(d)) hasExternalAttendee = true;
      const dealIds = domainToDealIds.get(d);
      if (!dealIds) continue;
      for (const dealId of dealIds) {
        const set = matchedDealsAndDomains.get(dealId) || new Set<string>();
        set.add(d);
        matchedDealsAndDomains.set(dealId, set);
      }
    }
    // Deal-less events with real external attendees are triage
    // candidates for the autopilot. (Internal-domain filtering happens
    // in the classifier, which knows the founder's own domains.)
    if (
      matchedDealsAndDomains.size === 0 &&
      hasExternalAttendee &&
      ev.id &&
      out.unmatchedEvents.length < MAX_UNMATCHED
    ) {
      let sameAccountCount = 0;
      for (const a of ev.attendees || []) {
        const d = domainFromEmail(a.email);
        if (!d || PUBLIC_EMAIL_DOMAINS.has(d)) continue;
        sameAccountCount = Math.max(sameAccountCount, domainEventCounts.get(d) || 0);
      }
      out.unmatchedEvents.push({
        calendarEventId: ev.id,
        title: ev.summary || "Meeting",
        description: (ev.description || "").substring(0, 2000),
        startsAt: ev.start?.dateTime || ev.start?.date || new Date().toISOString(),
        htmlLink: ev.htmlLink || null,
        attendees: (ev.attendees || [])
          .map((a) => ({ email: (a.email || "").toLowerCase(), name: a.displayName || null }))
          .filter((a) => !!a.email),
        isRecurring: !!ev.recurringEventId,
        futureMeetingsWithSameAccount: sameAccountCount,
      });
    }
    for (const [dealId, matched] of matchedDealsAndDomains) {
      const seen = seenByDeal.get(dealId);
      if (seen?.has(ev.id)) {
        skippedByDeal.set(dealId, (skippedByDeal.get(dealId) || 0) + 1);
        continue;
      }
      try {
        await createMeetingEntry(dealId, ev, matched);
        addedByDeal.set(dealId, (addedByDeal.get(dealId) || 0) + 1);
        dealsTouched.add(dealId);
        const s = seenByDeal.get(dealId) || new Set<string>();
        s.add(ev.id);
        seenByDeal.set(dealId, s);
      } catch (err) {
        console.error(`[scan-future-meetings] create entry failed (${dealId}, ${ev.id}):`, err);
      }
    }
  }

  // Back-link participants once per affected deal.
  for (const dealId of dealsTouched) {
    try { await backlinkEntryParticipants(dealId); } catch (err) {
      console.error(`[scan-future-meetings] backlink failed for ${dealId}:`, err);
    }
  }

  for (const deal of deals) {
    if (!dealDomains.has(deal.id)) continue;
    out.dealsScanned++;
    const added = addedByDeal.get(deal.id) || 0;
    const skipped = skippedByDeal.get(deal.id) || 0;
    out.totalEventsAdded += added;
    if (added > 0 || skipped > 0) {
      out.perDeal.push({ dealId: deal.id, dealName: deal.name, added, skipped });
    }
  }
  out.perDeal.sort((a, b) => b.added - a.added);
  return out;
}
