import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getGoogleAccessToken, hasGoogleCalendarScope } from "@/lib/google";
import { enrichAttendeesByEmail } from "@/lib/search/pdl";
import { parseSearchInput } from "@/lib/search/input-parser";
import { generateSearchPlan } from "@/lib/search/queries";
import { executeSearchPlan } from "@/lib/search/results";
import { synthesizeResearchBrief } from "@/lib/search/synthesis";
import { createResearchConversation } from "@/lib/search/research-conversation";
import { postResearchToSlack, postEnrichmentFailureNote } from "@/lib/pre-call/slack-broadcast";

/**
 * POST /api/cron/daily-research-briefs
 *
 * Runs daily (Vercel cron). For each user that has at least one
 * enabled recurring-research pattern:
 *   1. Pull today's external calendar meetings via the user's
 *      Google access token.
 *   2. Match titles against the user's saved patterns
 *      (case-insensitive substring).
 *   3. For each match we haven't processed yet:
 *      - Enrich attendees via PDL. If no person hits, post a
 *        "couldn't auto-research" note to the user's Slack and
 *        record an enrichment_failed run.
 *      - Otherwise synthesize a brief, persist it as a
 *        PreCallResearch row, and post it to Slack via the
 *        pattern's destination.
 *
 * Bearer-token gated via CRON_SECRET so Vercel cron can hit it.
 */

export const maxDuration = 300;

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com","googlemail.com","yahoo.com","outlook.com","hotmail.com",
  "icloud.com","me.com","aol.com","proton.me","protonmail.com","pm.me",
  "live.com","msn.com",
]);

interface GCalAttendee {
  email?: string;
  displayName?: string;
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
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  status?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: GCalAttendee[];
}

function domainFromEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase() || null;
}

// Per-user cap so a runaway calendar doesn't blow through API
// credits. Patterns are user-curated so this should rarely trigger.
const MAX_BRIEFS_PER_USER_PER_RUN = 5;

export async function POST(request: NextRequest) {
  // Vercel cron passes Authorization: Bearer <CRON_SECRET>. Reject
  // anything else so the endpoint can't be triggered externally.
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const users = await prisma.user.findMany({
    where: {
      recurringResearchPatterns: { some: { enabled: true } },
      googleRefreshToken: { not: null },
    },
    select: { id: true, accountId: true, email: true, slackEmail: true },
  });

  const summary: Array<{
    userId: string;
    matched: number;
    sent: number;
    failed: number;
    skipped: number;
  }> = [];

  for (const user of users) {
    const result = await processUser(user.id);
    summary.push({ userId: user.id, ...result });
  }

  return NextResponse.json({ ok: true, users: users.length, summary });
}

async function processUser(userId: string): Promise<{
  matched: number;
  sent: number;
  failed: number;
  skipped: number;
}> {
  const out = { matched: 0, sent: 0, failed: 0, skipped: 0 };

  const tokenRow = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      googleRefreshToken: true,
      googleScopes: true,
      accountId: true,
      email: true,
      slackEmail: true,
      workspaceId: true,
    },
  });
  if (!tokenRow?.googleRefreshToken || !hasGoogleCalendarScope(tokenRow.googleScopes)) {
    return out;
  }
  if (!tokenRow.workspaceId) return out;

  const accessToken = await getGoogleAccessToken(userId);
  if (!accessToken) return out;

  const patterns = await prisma.recurringResearchPattern.findMany({
    where: { userId, enabled: true },
  });
  if (patterns.length === 0) return out;

  // Determine the user's "self" email domain for filtering internal
  // attendees. Account.emailDomain wins, then user email, then
  // slackEmail.
  let recordDomain: string | null = null;
  if (tokenRow.accountId) {
    const acc = await prisma.account.findUnique({
      where: { id: tokenRow.accountId },
      select: { emailDomain: true },
    });
    recordDomain = acc?.emailDomain?.toLowerCase() || null;
  }
  if (!recordDomain) {
    recordDomain = domainFromEmail(tokenRow.email || tokenRow.slackEmail);
  }

  // Today's events — 24-hour window starting now.
  const timeMin = new Date();
  const timeMax = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const calUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  calUrl.searchParams.set("timeMin", timeMin.toISOString());
  calUrl.searchParams.set("timeMax", timeMax.toISOString());
  calUrl.searchParams.set("singleEvents", "true");
  calUrl.searchParams.set("orderBy", "startTime");
  calUrl.searchParams.set("maxResults", "100");

  const calRes = await fetch(calUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!calRes.ok) {
    console.error(`[cron daily-briefs] Calendar list failed for ${userId}: ${calRes.status}`);
    return out;
  }
  const calData = (await calRes.json()) as { items?: GCalEvent[] };
  const items = calData.items ?? [];

  let briefsThisRun = 0;

  for (const ev of items) {
    if (briefsThisRun >= MAX_BRIEFS_PER_USER_PER_RUN) break;
    if (ev.status === "cancelled") continue;
    if (!ev.start?.dateTime) continue;
    if (!ev.summary) continue;
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

    // Find which (if any) pattern matches this event title.
    const titleLower = ev.summary.toLowerCase();
    const matched = patterns.find((p) =>
      titleLower.includes(p.titlePattern.toLowerCase())
    );
    if (!matched) continue;
    out.matched++;

    // Skip if we've already processed this (pattern, event) combo.
    const existing = await prisma.recurringResearchRun.findUnique({
      where: { patternId_calendarEventId: { patternId: matched.id, calendarEventId: ev.id } },
    });
    if (existing) {
      out.skipped++;
      continue;
    }

    // PDL enrichment on external attendees.
    const enriched = await enrichAttendeesByEmail(
      externalAttendees.map((a) => ({
        name: a.displayName || "",
        email: a.email,
      }))
    );

    const primary =
      enriched.find((a) => a.company && a.title) ||
      enriched.find((a) => a.company) ||
      enriched.find((a) => {
        const d = domainFromEmail(a.email);
        return d && !PUBLIC_EMAIL_DOMAINS.has(d);
      }) ||
      enriched[0] ||
      null;

    const primaryDomain = primary ? domainFromEmail(primary.email) : null;
    // Cascade: PDL person company → first-word of the domain. We
    // only bail when we have neither a usable name nor a non-public
    // domain — otherwise we'll take a best-effort shot at web
    // research below.
    const companyFromDomain =
      primaryDomain && !PUBLIC_EMAIL_DOMAINS.has(primaryDomain)
        ? primaryDomain.split(".")[0].replace(/^./, (c) => c.toUpperCase())
        : "";
    const companyName = primary?.company || companyFromDomain;
    const contactName = primary?.name || "";

    const eventSnapshot = {
      id: ev.id,
      title: ev.summary,
      startsAt: ev.start.dateTime,
      endsAt: ev.end?.dateTime || null,
      description: ev.description?.trim() || null,
      location: ev.location?.trim() || null,
      meetingUrl:
        ev.hangoutLink ||
        ev.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ||
        null,
      eventUrl: ev.htmlLink || null,
      attendees: externalAttendees.map((a) => ({
        email: a.email || "",
        name: a.displayName || null,
      })),
    };

    // Only bail when we have neither a company name nor a contact
    // name to anchor research on. With at least one we still take
    // a best-effort shot at the brief — web research can fill in
    // the gaps PDL missed, especially for newer / smaller orgs.
    if (!companyName && !contactName) {
      await postEnrichmentFailureNote({
        userId,
        destination: matched.destination as "dm" | "channel",
        channelId: matched.channelId,
        eventTitle: ev.summary,
        eventStartsAt: ev.start.dateTime,
        reason: "We couldn't infer a company name or contact name from the meeting's external attendees.",
      });
      await prisma.recurringResearchRun.create({
        data: {
          userId,
          patternId: matched.id,
          calendarEventId: ev.id,
          status: "enrichment_failed",
          notes: "no_pdl_hit_no_company_no_name",
        },
      });
      out.failed++;
      continue;
    }

    // Generate the brief. Reuses the same pipeline as the manual
    // research-run endpoint, sans SSE plumbing.
    try {
      const parsedInput = await parseSearchInput({
        companyName,
        contactName: contactName || undefined,
        contactTitle: primary?.title || undefined,
        contactLinkedIn: primary?.linkedinUrl || undefined,
        urls: primaryDomain && !PUBLIC_EMAIL_DOMAINS.has(primaryDomain)
          ? [`https://${primaryDomain}`]
          : [],
      });
      const plan = generateSearchPlan(parsedInput);
      const results = await executeSearchPlan(plan, () => { /* no progress for cron */ });
      const brief = await synthesizeResearchBrief(results, () => {}, userId);

      const research = await prisma.preCallResearch.create({
        data: {
          userId,
          companyName: parsedInput.companyName,
          contactName: parsedInput.contactName,
          contactTitle: parsedInput.contactTitle,
          contactEmail: primary?.email || null,
          contactLinkedIn: parsedInput.contactLinkedIn || primary?.linkedinUrl || null,
          freeformInput: ev.summary,
          content: brief.content,
          searchContext: brief.searchContext,
          sources: brief.sources,
          source: "web",
          calendarEvent: eventSnapshot,
        },
      });

      // Create the chat conversation behind the brief so links from
      // Slack land on a usable in-app page.
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
      await createResearchConversation({
        userId,
        researchId: research.id,
        companyName: parsedInput.companyName,
        contactName: parsedInput.contactName,
        contactTitle: parsedInput.contactTitle,
        contactLinkedIn: parsedInput.contactLinkedIn,
        companyDomain: parsedInput.companyDomain,
        urls: parsedInput.companyDomain ? [`https://${parsedInput.companyDomain}`] : [],
        briefContent: brief.content,
        reportUrl: `${appUrl}/pre-call-planning/research?id=${research.id}`,
      });

      const post = await postResearchToSlack({
        userId,
        research: {
          id: research.id,
          companyName: research.companyName,
          contactName: research.contactName,
          contactTitle: research.contactTitle,
          contactEmail: research.contactEmail,
          contactLinkedIn: research.contactLinkedIn,
          content: research.content,
          calendarEvent: research.calendarEvent,
        },
        destination: matched.destination as "dm" | "channel",
        channelId: matched.channelId,
      });

      await prisma.recurringResearchRun.create({
        data: {
          userId,
          patternId: matched.id,
          calendarEventId: ev.id,
          status: post.ok ? "sent" : "post_failed",
          researchId: research.id,
          notes: post.ok ? null : ("error" in post ? post.error : null),
        },
      });
      await prisma.recurringResearchPattern.update({
        where: { id: matched.id },
        data: { lastRunAt: new Date() },
      });

      briefsThisRun++;
      if (post.ok) {
        out.sent++;
      } else {
        out.failed++;
      }
    } catch (err) {
      console.error(`[cron daily-briefs] Brief generation failed for ${userId} / event ${ev.id}:`, err);
      await postEnrichmentFailureNote({
        userId,
        destination: matched.destination as "dm" | "channel",
        channelId: matched.channelId,
        eventTitle: ev.summary,
        eventStartsAt: ev.start.dateTime,
        reason: `Research generation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      await prisma.recurringResearchRun.create({
        data: {
          userId,
          patternId: matched.id,
          calendarEventId: ev.id,
          status: "brief_failed",
          notes: err instanceof Error ? err.message : String(err),
        },
      });
      out.failed++;
    }
  }

  return out;
}
