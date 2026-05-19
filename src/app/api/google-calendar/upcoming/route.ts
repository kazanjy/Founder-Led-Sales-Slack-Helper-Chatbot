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

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

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
  // Fallback: user's own email domain if no account domain set.
  const userDomain =
    accountDomain || domainFromEmail(user.email || user.slackEmail || undefined);

  const timeMin = new Date();
  const timeMax = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "50");

  const res = await fetch(url.toString(), {
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

    // Find external attendees (not on the user/account domain and
    // not a personal-email provider domain we can't infer a company
    // from).
    const externalAttendees = ev.attendees.filter((a) => {
      const dom = domainFromEmail(a.email);
      if (!dom) return false;
      if (userDomain && dom === userDomain) return false;
      return true;
    });

    if (externalAttendees.length === 0) continue;

    // Pick the first non-public-domain external attendee as the
    // "primary" prospect for prefill. Fall back to the first
    // external attendee if all are public domains.
    const primary =
      externalAttendees.find((a) => {
        const dom = domainFromEmail(a.email);
        return dom && !PUBLIC_EMAIL_DOMAINS.has(dom);
      }) || externalAttendees[0];

    const primaryDomain = domainFromEmail(primary.email);
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
        contactName: primary.displayName || "",
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
