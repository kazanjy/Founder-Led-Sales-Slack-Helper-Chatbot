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
  location?: string;
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
  description: string | null;
  location: string | null;
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
  // ?days=N expands the time window (default 14); the UI bumps this
  // when the user clicks "Load more meetings".
  // ?limit=N caps how many events we return (default 10).
  const url = new URL(request.url);
  const filterMode = url.searchParams.get("filter") === "all" ? "all" : "external";
  const daysRaw = parseInt(url.searchParams.get("days") || "", 10);
  const daysAhead = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 180) : 14;
  const limitRaw = parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 10;

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
  const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);

  const calendarUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  calendarUrl.searchParams.set("timeMin", timeMin.toISOString());
  calendarUrl.searchParams.set("timeMax", timeMax.toISOString());
  calendarUrl.searchParams.set("singleEvents", "true");
  calendarUrl.searchParams.set("orderBy", "startTime");
  // Pull a generous raw page so the filter (cancelled/declined/internal)
  // doesn't starve us out before we hit the requested limit.
  calendarUrl.searchParams.set("maxResults", String(Math.max(50, limit * 5)));

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
      description: ev.description?.trim() || null,
      location: ev.location?.trim() || null,
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

    if (events.length >= limit) break;
  }

  // hasMore is a best-effort hint for the UI: true if we hit the
  // limit (more events likely beyond the current window) OR if
  // Google returned a continuation token within the same window.
  const hasMore = events.length >= limit;

  // Map each returned calendar event id to an existing pre-call
  // research brief for this user, so the UI can show "Researched"
  // and link to the saved brief instead of re-running research.
  const eventIds = events.map((e) => e.id);
  let briefsByEventId: Record<string, string> = {};
  if (eventIds.length > 0) {
    // Prisma's JSON filter doesn't support `in` with `path`, so we
    // pull the user's recent briefs and filter in-memory. Bounded by
    // `take` so a power user with thousands of briefs doesn't make
    // this query expensive. Most users have a few dozen.
    try {
      const existing = await prisma.preCallResearch.findMany({
        where: { userId: user.id },
        select: { id: true, calendarEvent: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      const idSet = new Set(eventIds);
      const acc: Record<string, string> = {};
      for (const row of existing) {
        const evId = (row.calendarEvent as { id?: string } | null)?.id;
        if (!evId || !idSet.has(evId)) continue;
        if (!acc[evId]) acc[evId] = row.id; // first (most recent) wins
      }
      briefsByEventId = acc;
    } catch (err) {
      // Schema migration not applied yet, or transient DB issue —
      // never let it tank the core calendar listing.
      console.error("[upcoming] briefsByEventId lookup failed:", err);
    }
  }

  // Same idea for persisted PDL enrichment attempts — lets the tile
  // show "Enriched N of M from PDL" across page refreshes for events
  // that don't (yet) have a brief.
  let attemptsByEventId: Record<string, { pdlHits: number; total: number; companyFallback: boolean }> = {};
  if (eventIds.length > 0) {
    try {
      const attempts = await prisma.preCallEnrichmentAttempt.findMany({
        where: { userId: user.id, calendarEventId: { in: eventIds } },
        select: { calendarEventId: true, pdlHits: true, total: true, companyFallback: true },
      });
      const acc: Record<string, { pdlHits: number; total: number; companyFallback: boolean }> = {};
      for (const a of attempts) {
        acc[a.calendarEventId] = {
          pdlHits: a.pdlHits,
          total: a.total,
          companyFallback: a.companyFallback,
        };
      }
      attemptsByEventId = acc;
    } catch (err) {
      // Migration 20260520000001 (pre_call_enrichment_attempts)
      // hasn't been applied yet — keep the calendar list working.
      console.error("[upcoming] attemptsByEventId lookup failed:", err);
    }
  }

  return NextResponse.json({ events, daysAhead, hasMore, briefsByEventId, attemptsByEventId });
}
