import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGoogleAccessToken, hasGoogleCalendarScope } from "@/lib/google";

export const dynamic = "force-dynamic";

/**
 * Calendar search used by the New Deal modal's Calendar tab. Pulls a
 * window of past + future events (clamped 0–90d each direction), filters
 * to "looks like a sales meeting" (has attendees, has time, has at least
 * one external attendee), and returns the raw set so the client can do
 * substring search across title / description / attendee email + name
 * without per-keystroke server roundtrips.
 *
 * Parallel to /api/google-calendar/upcoming but skinnier — no pre-call
 * research lookup, no PDL enrichment attempts. Just the data the user
 * needs to decide which events to attach to a new deal.
 */

interface GCalAttendee {
  email?: string;
  displayName?: string;
  organizer?: boolean;
  self?: boolean;
  responseStatus?: string;
}

interface GCalEvent {
  id: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: GCalAttendee[];
}

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "live.com", "msn.com",
]);

function domainFromEmail(email: string | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase() || null;
}

function companyNameFromDomain(domain: string): string {
  const root = domain.split(".")[0] || domain;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

function clampDays(raw: string | null, def: number, max = 90): number {
  const n = parseInt(raw || "", 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, 0), max);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const lookback = clampDays(url.searchParams.get("lookback"), 30);
  const lookforward = clampDays(url.searchParams.get("lookforward"), 30);

  const tokenRow = await prisma.user.findUnique({
    where: { id: user.id },
    select: { googleRefreshToken: true, googleScopes: true },
  });
  if (!tokenRow?.googleRefreshToken || !hasGoogleCalendarScope(tokenRow.googleScopes)) {
    return NextResponse.json({ error: "calendar_not_connected", events: [] }, { status: 403 });
  }
  const accessToken = await getGoogleAccessToken(user.id);
  if (!accessToken) {
    return NextResponse.json({ error: "calendar_not_connected", events: [] }, { status: 403 });
  }

  let accountDomain: string | null = null;
  if (user.accountId) {
    const account = await prisma.account.findUnique({
      where: { id: user.accountId },
      select: { emailDomain: true },
    });
    accountDomain = account?.emailDomain?.toLowerCase() || null;
  }
  const recordDomain =
    accountDomain || domainFromEmail(user.email || user.slackEmail || undefined);

  const timeMin = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000);
  const timeMax = new Date(Date.now() + lookforward * 24 * 60 * 60 * 1000);

  // Paginate so a busy 60-day window past the 250-cap still gets fully
  // scanned. Hard ceiling at ~600 raw events keeps the response bounded.
  const rawEvents: GCalEvent[] = [];
  let pageToken: string | undefined;
  do {
    const calUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    calUrl.searchParams.set("timeMin", timeMin.toISOString());
    calUrl.searchParams.set("timeMax", timeMax.toISOString());
    calUrl.searchParams.set("singleEvents", "true");
    calUrl.searchParams.set("orderBy", "startTime");
    calUrl.searchParams.set("maxResults", "250");
    if (pageToken) calUrl.searchParams.set("pageToken", pageToken);
    const res = await fetch(calUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.error("[calendar-search] list failed:", res.status);
      return NextResponse.json({ error: "calendar_fetch_failed", events: [] }, { status: 502 });
    }
    const data = (await res.json()) as { items?: GCalEvent[]; nextPageToken?: string };
    if (Array.isArray(data.items)) rawEvents.push(...data.items);
    pageToken = data.nextPageToken;
    if (rawEvents.length >= 600) break;
  } while (pageToken);

  const events = [];
  for (const ev of rawEvents) {
    if (ev.status === "cancelled") continue;
    if (!ev.start?.dateTime) continue; // skip all-day events
    if (!ev.attendees || ev.attendees.length === 0) continue;

    const selfAttendee = ev.attendees.find((a) => a.self);
    if (selfAttendee?.responseStatus === "declined") continue;

    const selfDomain = domainFromEmail(selfAttendee?.email) || recordDomain;
    const externalAttendees = ev.attendees.filter((a) => {
      const dom = domainFromEmail(a.email);
      if (!dom) return false;
      if (selfDomain && dom === selfDomain) return false;
      return true;
    });
    if (externalAttendees.length === 0) continue;

    const primary =
      externalAttendees.find((a) => {
        const dom = domainFromEmail(a.email);
        return dom && !PUBLIC_EMAIL_DOMAINS.has(dom);
      }) || externalAttendees[0];
    const primaryDomain = primary ? domainFromEmail(primary.email) : null;
    const inferredCompany =
      primaryDomain && !PUBLIC_EMAIL_DOMAINS.has(primaryDomain)
        ? { name: companyNameFromDomain(primaryDomain), url: `https://${primaryDomain}` }
        : null;

    const meetingUrl =
      ev.hangoutLink ||
      ev.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ||
      null;

    events.push({
      id: ev.id,
      title: ev.summary || "(no title)",
      startsAt: ev.start.dateTime,
      endsAt: ev.end?.dateTime || null,
      meetingUrl,
      eventUrl: ev.htmlLink || null,
      description: ev.description?.trim() || null,
      inferredCompany,
      attendees: externalAttendees.map((a) => ({
        email: a.email || "",
        name: a.displayName || null,
        external: true,
      })),
    });
  }

  // Newest first — the calendar API returns oldest-first within the
  // window, but the UI is more useful with recent meetings at the top.
  events.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

  return NextResponse.json({
    events,
    windowDays: { back: lookback, forward: lookforward },
    rawScanned: rawEvents.length,
  });
}
