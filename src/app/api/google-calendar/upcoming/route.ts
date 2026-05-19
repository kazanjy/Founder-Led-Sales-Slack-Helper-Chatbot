import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGoogleAccessToken, hasGoogleCalendarScope } from "@/lib/google";

export const dynamic = "force-dynamic";

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
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string; label?: string }>;
  };
  status?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: GCalAttendee[];
  organizer?: { email?: string; self?: boolean };
}

interface UpcomingEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  meetingUrl: string | null;
  eventUrl: string | null;
  prefill: {
    companyName: string;
    contactName: string;
    contactTitle: string;
    contactLinkedIn: string;
    companyUrl: string;
  };
  attendees: Array<{ email: string; name: string | null; external: boolean }>;
}

// Heuristic: pull the "company" name from an attendee email's domain.
// Strip the obvious public domains and common provider names. Caller
// is responsible for filtering internal/self domains first.
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "live.com", "msn.com",
]);

function domainFromEmail(email: string | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).toLowerCase();
  return d || null;
}

function companyNameFromDomain(domain: string): string {
  const root = domain.split(".")[0] || domain;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // ?filter=external (default) keeps only events with at least one
  // attendee whose email domain differs from the user's own domain
  // — the typical sales-call shape. ?filter=all turns the filter off
  // so users can browse personal/internal events too.
  const url = new URL(request.url);
  const filterMode = url.searchParams.get("filter") === "all" ? "all" : "external";

  const tokenRow = await prisma.user.findUnique({
    where: { id: user.id },
    select: { googleRefreshToken: true, googleScopes: true },
  });

  if (!tokenRow?.googleRefreshToken || !hasGoogleCalendarScope(tokenRow.googleScopes)) {
    return NextResponse.json(
      { error: "calendar_not_connected", events: [] },
      { status: 403 }
    );
  }

  const accessToken = await getGoogleAccessToken(user.id);
  if (!accessToken) {
    return NextResponse.json(
      { error: "calendar_not_connected", events: [] },
      { status: 403 }
    );
  }

  // Pull the account's email domain so we can flag internal attendees.
  let accountDomain: string | null = null;
  if (user.accountId) {
    const account = await prisma.account.findUnique({
      where: { id: user.accountId },
      select: { emailDomain: true },
    });
    accountDomain = account?.emailDomain?.toLowerCase() || null;
  }
  // The Google-authed identity may differ from slackEmail on Slack-
  // first users. Fall back order: account.emailDomain > user.email >
  // user.slackEmail > the per-event self-attendee domain set below.
  const recordDomain =
    accountDomain || domainFromEmail(user.email || user.slackEmail || undefined);

  const timeMin = new Date();
  const timeMax = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const calendarUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  calendarUrl.searchParams.set("timeMin", timeMin.toISOString());
  calendarUrl.searchParams.set("timeMax", timeMax.toISOString());
  calendarUrl.searchParams.set("singleEvents", "true");
  calendarUrl.searchParams.set("orderBy", "startTime");
  calendarUrl.searchParams.set("maxResults", "50");

  const res = await fetch(calendarUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[google-calendar/upcoming] List failed:", res.status, body.slice(0, 300));
    return NextResponse.json(
      { error: "calendar_fetch_failed", events: [] },
      { status: 502 }
    );
  }

  const data = (await res.json()) as { items?: GCalEvent[] };
  const items = data.items ?? [];

  const events: UpcomingEvent[] = [];

  for (const ev of items) {
    if (ev.status === "cancelled") continue;
    if (!ev.start?.dateTime) continue; // skip all-day events
    if (!ev.attendees || ev.attendees.length === 0) continue; // solo blocks

    // Skip events the user has declined.
    const selfAttendee = ev.attendees.find((a) => a.self);
    if (selfAttendee?.responseStatus === "declined") continue;

    // Best self-domain we can compute for this event: prefer the
    // attendee Google marked self (most reliable for Slack-first
    // users whose Google identity differs from their slackEmail), then
    // fall back to the account/user-record domain.
    const selfDomain = domainFromEmail(selfAttendee?.email) || recordDomain;

    // External = attendee with a domain that isn't the user's own.
    const externalAttendees = ev.attendees.filter((a) => {
      const dom = domainFromEmail(a.email);
      if (!dom) return false;
      if (selfDomain && dom === selfDomain) return false;
      return true;
    });

    if (filterMode === "external" && externalAttendees.length === 0) continue;

    // Pick the first non-public-domain external attendee as the
    // "primary" prospect for prefill. Falls back to the first
    // external attendee if all are public domains. With filter=all
    // there may be no external attendees at all — leave prefill blank.
    const primary =
      externalAttendees.find((a) => {
        const dom = domainFromEmail(a.email);
        return dom && !PUBLIC_EMAIL_DOMAINS.has(dom);
      }) || externalAttendees[0] || null;

    const primaryDomain = primary ? domainFromEmail(primary.email) : null;
    const companyName =
      primaryDomain && !PUBLIC_EMAIL_DOMAINS.has(primaryDomain)
        ? companyNameFromDomain(primaryDomain)
        : "";
    const companyUrl =
      primaryDomain && !PUBLIC_EMAIL_DOMAINS.has(primaryDomain)
        ? `https://${primaryDomain}`
        : "";

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
      prefill: {
        companyName,
        contactName: primary?.displayName || "",
        contactTitle: "",
        contactLinkedIn: "",
        companyUrl,
      },
      attendees: externalAttendees.map((a) => ({
        email: a.email || "",
        name: a.displayName || null,
        external: true,
      })),
    });

    if (events.length >= 10) break;
  }

  return NextResponse.json({ events });
}
