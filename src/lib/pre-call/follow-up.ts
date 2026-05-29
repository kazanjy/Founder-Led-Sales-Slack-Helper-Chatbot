import { prisma } from "@/lib/db";
import { getGoogleAccessToken, hasGoogleCalendarScope } from "@/lib/google";
import { getProvider } from "@/lib/meeting-recorder/providers";

/**
 * Pre-call research follow-up detection + transcript pull.
 *
 * Flow per prospect domain:
 *   1. Look at the user's Google Calendar history for events in the
 *      last 180 days that have at least one attendee from the
 *      prospect's domain. If any → "follow-up call".
 *   2. If follow-up, ask the user's connected meeting recorder for
 *      calls in the last 90 days whose participants include anyone
 *      at the prospect's domain. Pull full transcripts for matches.
 *   3. Return a stitched markdown block the synthesis prompt can
 *      inline so the LLM has the full history when writing the
 *      follow-up section of the brief.
 *
 * Failures are non-fatal — research always proceeds. Missing
 * Calendar access just falls back to "first call". Missing recorder
 * means "follow-up mode but no transcripts". Caller passes the
 * `prospectDomain` we already inferred elsewhere (PDL or attendee
 * email parse), so this lib doesn't need to re-derive it.
 */

const LOOKBACK_DAYS_CALENDAR = 180;
const LOOKBACK_DAYS_RECORDER = 90;

export interface PriorCalendarEvent {
  id: string;
  title: string;
  startsAt: string;
  attendees: Array<{ email: string; name: string | null }>;
}

export interface PriorRecordedCall {
  callId: string;
  provider: string;
  title: string;
  date: string;
  participants: string[];
  transcript: string;
  summary?: string;
  url?: string;
}

export interface FollowUpContext {
  isFollowUp: boolean;
  prospectDomain: string;
  priorCalendarEvents: PriorCalendarEvent[];
  priorRecordedCalls: PriorRecordedCall[];
  recorderProvider: string | null;
}

function normalizeDomain(d: string | null | undefined): string {
  return (d || "").trim().toLowerCase().replace(/^www\./, "");
}

function domainFromEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return normalizeDomain(email.slice(at + 1));
}

/**
 * Phase 1: did this user meet anyone at the prospect's domain in
 * the last 180 days? Returns the matching events (with attendees)
 * so the brief can show the user *what* counted.
 */
async function findPriorCalendarEvents(
  userId: string,
  prospectDomain: string
): Promise<PriorCalendarEvent[]> {
  const domain = normalizeDomain(prospectDomain);
  if (!domain) return [];

  const tokenRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleRefreshToken: true, googleScopes: true },
  });
  if (!tokenRow?.googleRefreshToken || !hasGoogleCalendarScope(tokenRow.googleScopes)) {
    return [];
  }
  const accessToken = await getGoogleAccessToken(userId);
  if (!accessToken) return [];

  const timeMin = new Date(Date.now() - LOOKBACK_DAYS_CALENDAR * 24 * 60 * 60 * 1000);
  const timeMax = new Date();

  // Google's `q` param does free-text search across summary +
  // description + attendees, so the domain string usually surfaces
  // hits cheaply. We still re-validate attendees client-side.
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "250");
  url.searchParams.set("q", domain);

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.error("[follow-up] Calendar query failed:", res.status);
      return [];
    }
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        status?: string;
        start?: { dateTime?: string };
        attendees?: Array<{ email?: string; displayName?: string; self?: boolean; responseStatus?: string }>;
      }>;
    };
    const items = data.items ?? [];
    const matches: PriorCalendarEvent[] = [];
    for (const ev of items) {
      if (ev.status === "cancelled") continue;
      if (!ev.start?.dateTime) continue;
      const atts = ev.attendees || [];
      const domainHits = atts.filter((a) => domainFromEmail(a.email) === domain);
      if (domainHits.length === 0) continue;
      matches.push({
        id: ev.id,
        title: ev.summary || "(no title)",
        startsAt: ev.start.dateTime,
        attendees: domainHits.map((a) => ({
          email: a.email || "",
          name: a.displayName || null,
        })),
      });
    }
    return matches;
  } catch (err) {
    console.error("[follow-up] Calendar fetch threw:", err);
    return [];
  }
}

/**
 * Phase 2: pull transcripts for calls in the last 90 days whose
 * participants include the prospect's domain. Uses the user's
 * single connected recorder.
 */
async function findPriorRecordedCalls(
  userId: string,
  prospectDomain: string
): Promise<{ calls: PriorRecordedCall[]; provider: string | null }> {
  const domain = normalizeDomain(prospectDomain);
  if (!domain) return { calls: [], provider: null };

  const conn = await prisma.meetingRecorderConnection.findFirst({
    where: { userId, status: "active" },
    orderBy: { lastSyncedAt: "desc" },
  });
  if (!conn) return { calls: [], provider: null };

  const provider = getProvider(conn.provider);
  if (!provider) return { calls: [], provider: conn.provider };

  let candidates;
  try {
    candidates = await provider.listCalls(conn.accessToken, 50);
  } catch (err) {
    console.error(`[follow-up] ${conn.provider} listCalls failed:`, err);
    return { calls: [], provider: conn.provider };
  }

  const cutoff = Date.now() - LOOKBACK_DAYS_RECORDER * 24 * 60 * 60 * 1000;
  const matches = candidates.filter((c) => {
    const t = c.date ? new Date(c.date).getTime() : 0;
    if (t < cutoff) return false;
    const emails = (c.attendees || [])
      .map((a) => domainFromEmail(a.email))
      .filter(Boolean) as string[];
    return emails.includes(domain);
  });

  const out: PriorRecordedCall[] = [];
  for (const c of matches) {
    try {
      const detail = await provider.getCallDetail(conn.accessToken, c.id);
      out.push({
        callId: c.id,
        provider: conn.provider,
        title: c.title,
        date: c.date,
        participants: c.participants || [],
        transcript: detail.transcript || "",
        summary: detail.summary || undefined,
        url: c.providerUrl,
      });
    } catch (err) {
      console.error(`[follow-up] ${conn.provider} getCallDetail failed for ${c.id}:`, err);
    }
  }

  // Most-recent first so the LLM weights latest interactions higher.
  out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return { calls: out, provider: conn.provider };
}

export async function detectFollowUpContext(
  userId: string,
  prospectDomain: string | null | undefined
): Promise<FollowUpContext> {
  const domain = normalizeDomain(prospectDomain || "");
  const empty: FollowUpContext = {
    isFollowUp: false,
    prospectDomain: domain,
    priorCalendarEvents: [],
    priorRecordedCalls: [],
    recorderProvider: null,
  };
  if (!domain) return empty;

  const priorCalendarEvents = await findPriorCalendarEvents(userId, domain);
  const isFollowUp = priorCalendarEvents.length > 0;
  if (!isFollowUp) return { ...empty, prospectDomain: domain };

  const { calls, provider } = await findPriorRecordedCalls(userId, domain);
  return {
    isFollowUp: true,
    prospectDomain: domain,
    priorCalendarEvents,
    priorRecordedCalls: calls,
    recorderProvider: provider,
  };
}

/**
 * Markdown context block to inject into the synthesis prompt when
 * we detect follow-up mode. The synthesis prompt is extended to
 * call out a "Follow-up section" of the brief that consumes this.
 * The block is intentionally verbose — no truncation here because
 * we flip to DIRECT mode when the combined payload exceeds
 * Chatbase's effective capacity (~21k chars).
 */
export function buildFollowUpContextBlock(ctx: FollowUpContext): string {
  if (!ctx.isFollowUp) return "";

  const lines: string[] = [];
  lines.push("## FOLLOW-UP CONTEXT");
  lines.push(
    `This is a **follow-up call** with someone at \`${ctx.prospectDomain}\`. ` +
      `We've detected ${ctx.priorCalendarEvents.length} prior calendar event(s) ` +
      `in the last ${LOOKBACK_DAYS_CALENDAR} days with their domain.`
  );
  lines.push("");

  // Calendar history (always present in follow-up mode).
  lines.push("### Prior calendar events (last 180 days)");
  for (const ev of ctx.priorCalendarEvents) {
    const date = new Date(ev.startsAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const atts = ev.attendees
      .map((a) => (a.name ? `${a.name} <${a.email}>` : a.email))
      .join(", ");
    lines.push(`- **${date}** — ${ev.title} — attendees from domain: ${atts}`);
  }
  lines.push("");

  if (ctx.priorRecordedCalls.length > 0) {
    lines.push(
      `### Recorded calls from ${ctx.recorderProvider || "the connected recorder"} (last 90 days)`
    );
    lines.push(
      `Full transcripts follow. Use them to ground the follow-up section of the ` +
        `brief: what was discussed, what was committed to, and what threads are still open.`
    );
    lines.push("");
    for (const call of ctx.priorRecordedCalls) {
      const date = new Date(call.date).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      lines.push(`#### ${date} — ${call.title}`);
      if (call.participants.length > 0) {
        lines.push(`Participants: ${call.participants.join(", ")}`);
      }
      if (call.url) lines.push(`Recording: ${call.url}`);
      if (call.summary) {
        lines.push("");
        lines.push("**Summary**");
        lines.push(call.summary);
      }
      if (call.transcript) {
        lines.push("");
        lines.push("**Transcript**");
        lines.push("```");
        lines.push(call.transcript);
        lines.push("```");
      }
      lines.push("");
    }
  } else if (ctx.recorderProvider) {
    lines.push(
      `### No recorded calls found on ${ctx.recorderProvider} in the last ${LOOKBACK_DAYS_RECORDER} days for this domain.`
    );
    lines.push("");
  } else {
    lines.push(
      "### No call recorder connected. Follow-up section will rely on calendar history only."
    );
    lines.push("");
  }

  return lines.join("\n");
}
