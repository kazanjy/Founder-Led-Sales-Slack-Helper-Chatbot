import { prisma } from "@/lib/db";
import { getGoogleAccessToken, hasGoogleCalendarScope } from "@/lib/google";
import {
  ensurePotentialDealForDomain,
  getSelfDomains,
} from "@/lib/deals/auto-detect";
import { scanUserRecordings, type ScanSummary } from "@/lib/deals/scan-recordings";

/**
 * Manual "Look for new deals" trigger. Runs both pipelines against
 * a broader lookback than the scheduled crons:
 *   - recorder: latest 50 calls (same as the hourly scanner)
 *   - calendar: last 30 days of external events
 *
 * Briefs are NOT generated for the calendar sweep — too slow and
 * expensive for an interactive button. Just deal creation /
 * attachment via the shared auto-detect helper. Slack alerts still
 * fire on created Potentials so the Validate/Dismiss flow stays
 * consistent with the cron pipelines.
 */

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "live.com", "msn.com",
]);

function domainFromEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).trim().toLowerCase().replace(/^www\./, "");
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
  status?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: GCalAttendee[];
}

export interface CalendarDiscoverySummary {
  available: boolean;
  scanned: number;
  attached: number;
  potentials: number;
  skipped: number;
  errors: number;
}

export interface DiscoverDealsSummary {
  recorder: ScanSummary & { available: boolean };
  calendar: CalendarDiscoverySummary;
}

const CALENDAR_LOOKBACK_DAYS = 30;
const CALENDAR_MAX_EVENTS = 250;

async function scanCalendarPast(userId: string): Promise<CalendarDiscoverySummary> {
  const out: CalendarDiscoverySummary = {
    available: false,
    scanned: 0,
    attached: 0,
    potentials: 0,
    skipped: 0,
    errors: 0,
  };

  const tokenRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleRefreshToken: true, googleScopes: true },
  });
  if (!tokenRow?.googleRefreshToken || !hasGoogleCalendarScope(tokenRow.googleScopes)) {
    return out;
  }
  const accessToken = await getGoogleAccessToken(userId);
  if (!accessToken) return out;
  out.available = true;

  const self = await getSelfDomains(userId);

  const timeMin = new Date(Date.now() - CALENDAR_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const timeMax = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(CALENDAR_MAX_EVENTS));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    console.error(`[discover] Calendar list failed for ${userId}: ${res.status}`);
    out.errors++;
    return out;
  }
  const data = (await res.json()) as { items?: GCalEvent[] };
  const events = data.items ?? [];

  // Dedupe domains within this sweep — many calendars have weekly
  // recurring meetings with the same prospect; we only want to
  // touch each domain once.
  const seenDomains = new Set<string>();

  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    if (!ev.attendees || ev.attendees.length === 0) continue;
    out.scanned++;

    const externalDomains = ev.attendees
      .map((a) => domainFromEmail(a.email))
      .filter((d): d is string => !!d)
      .filter((d) => !self.has(d) && !PUBLIC_EMAIL_DOMAINS.has(d));
    if (externalDomains.length === 0) continue;

    const primary = externalDomains[0];
    if (seenDomains.has(primary)) {
      out.skipped++;
      continue;
    }
    seenDomains.add(primary);

    try {
      const detection = await ensurePotentialDealForDomain({
        userId,
        domain: primary,
        source: "calendar",
        selfDomains: self,
      });
      if (detection.kind === "created_potential") out.potentials++;
      else if (detection.kind === "attached_existing") out.attached++;
      else out.skipped++;
    } catch (err) {
      console.error(`[discover] calendar deal detection failed for ${primary}:`, err);
      out.errors++;
    }
  }

  return out;
}

export async function discoverDealsForUser(userId: string): Promise<DiscoverDealsSummary> {
  const [recorderConn] = await Promise.all([
    prisma.meetingRecorderConnection.findFirst({
      where: { userId, status: "active" },
      select: { id: true },
    }),
  ]);

  const recorderPromise = recorderConn
    ? scanUserRecordings(userId).then((s) => ({ ...s, available: true }))
    : Promise.resolve({
        userId,
        scanned: 0,
        attached: 0,
        potentials: 0,
        skipped: 0,
        errors: 0,
        available: false,
      });

  const [recorder, calendar] = await Promise.all([recorderPromise, scanCalendarPast(userId)]);
  return { recorder, calendar };
}
