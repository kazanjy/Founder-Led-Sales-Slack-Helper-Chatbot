import type { WebClient } from "@slack/web-api";
import { prisma } from "@/lib/db";
import { getSlackClient, sendSlackMessage } from "@/lib/slack/client";

/**
 * Shared helpers for posting a pre-call research brief to Slack —
 * used by both the manual "Send to Slack" button and the daily
 * recurring-pattern cron. Keeps message formatting + posting in one
 * place so the cron output looks identical to the on-demand send.
 */

const SMALL_WORDS = new Set([
  "a","an","and","as","at","but","by","for","from","in",
  "of","on","or","the","to","via","with",
]);
function capitalizeWord(word: string): string {
  if (!word) return word;
  if (/^[A-Z]{2,}$/.test(word)) return word;
  if (/^[ivx]+$/i.test(word)) return word.toUpperCase();
  return word.replace(/(^|[-/])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}
export function toTitleCase(s: string | null | undefined): string {
  if (!s) return "";
  const tokens = s.split(/(\s+)/);
  let firstWordSeen = false;
  return tokens
    .map((tok) => {
      if (/^\s+$/.test(tok)) return tok;
      const lower = tok.toLowerCase();
      const isFirst = !firstWordSeen;
      firstWordSeen = true;
      const stripped = lower.replace(/[.,;:!?]/g, "");
      if (!isFirst && SMALL_WORDS.has(stripped)) return lower;
      return capitalizeWord(tok);
    })
    .join("");
}

function normalizeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const t = u.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^mailto:/i.test(t)) return t;
  return `https://${t.replace(/^\/+/, "")}`;
}

export function markdownToSlack(md: string): string {
  return md
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    .replace(/^[\-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SLACK_MESSAGE_CHAR_LIMIT = 35000;

// Cap on how much of the executive summary we'll inline into the
// parent Slack message. Slack renders 4000+ chars per block fine,
// but parents that scroll forever defeat the point of having a
// thread. Anything beyond this stays in the thread reply.
const EXEC_SUMMARY_CHAR_LIMIT = 1500;

/**
 * Split the brief into an "exec summary" chunk (everything before
 * the start of the rest of the report) and the body. Prefers the
 * canonical "Company Snapshot" section header (the next section
 * after TL;DR in our synthesis prompt) so format drift on the
 * heading levels doesn't trip the split. Falls back to the second
 * markdown heading, then to the first 1200 chars of prose, so the
 * parent always carries some value when the brief has content.
 */
function splitExecSummary(content: string): { execSummary: string; rest: string } {
  if (!content) return { execSummary: "", rest: "" };
  const lines = content.split("\n");

  // 1. Look for an explicit "Company Snapshot" line in any common
  //    heading variant (### / ## / # / **bold** / plain).
  const companySnapshotPattern = /^(#{1,6}\s+|\*\*)?company snapshot/i;
  let splitIdx = lines.findIndex((l) => companySnapshotPattern.test(l.trim()));

  // 2. Failing that, take the second markdown heading.
  if (splitIdx < 0) {
    let headingsSeen = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^#{1,6}\s+/.test(lines[i])) {
        headingsSeen++;
        if (headingsSeen === 2) {
          splitIdx = i;
          break;
        }
      }
    }
  }

  // 3. Last resort: first 1200 chars as summary.
  if (splitIdx < 0) {
    if (content.length <= EXEC_SUMMARY_CHAR_LIMIT) {
      return { execSummary: content.trim(), rest: "" };
    }
    return {
      execSummary: content.slice(0, EXEC_SUMMARY_CHAR_LIMIT).trimEnd() + "…",
      rest: content,
    };
  }

  let execSummary = lines.slice(0, splitIdx).join("\n").trim();
  const rest = lines.slice(splitIdx).join("\n");
  if (execSummary.length > EXEC_SUMMARY_CHAR_LIMIT) {
    execSummary = execSummary.slice(0, EXEC_SUMMARY_CHAR_LIMIT - 1).trimEnd() + "…";
  }
  return { execSummary, rest };
}

export interface ResearchForSlack {
  id: string;
  companyName: string;
  contactName: string | null;
  contactTitle: string | null;
  contactEmail: string | null;
  contactLinkedIn: string | null;
  content: string;
  calendarEvent: unknown;
}

/**
 * Build the parent header text + threaded body text for a research
 * brief Slack post. Pure function — does no IO.
 */
export function buildResearchSlackMessage(research: ResearchForSlack): {
  headerText: string;
  bodyText: string;
  truncated: boolean;
} {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
  const reportUrl = `${appUrl}/pre-call-planning/research?id=${research.id}`;

  const companyDisplay = toTitleCase(research.companyName);
  const contactDisplay = toTitleCase(research.contactName);
  const titleDisplay = toTitleCase(research.contactTitle);

  const calEvent = research.calendarEvent as
    | {
        id?: string;
        title?: string;
        startsAt?: string;
        endsAt?: string | null;
        description?: string | null;
        location?: string | null;
        meetingUrl?: string | null;
        eventUrl?: string | null;
        attendees?: Array<{ email: string; name?: string | null }>;
      }
    | null
    | undefined;

  const lines: string[] = [];

  if (calEvent?.title) {
    lines.push(`📅 *${calEvent.title}*`);
    if (calEvent.startsAt) {
      const startSec = Math.floor(new Date(calEvent.startsAt).getTime() / 1000);
      const fallback = new Date(calEvent.startsAt).toUTCString();
      const startTok = `<!date^${startSec}^{date_short_pretty} at {time}|${fallback}>`;
      let endTok = "";
      if (calEvent.endsAt) {
        const endSec = Math.floor(new Date(calEvent.endsAt).getTime() / 1000);
        const endFallback = new Date(calEvent.endsAt).toUTCString();
        endTok = ` – <!date^${endSec}^{time}|${endFallback}>`;
      }
      lines.push(`🕒 ${startTok}${endTok}`);
    }
    if (calEvent.attendees && calEvent.attendees.length > 0) {
      const attLine = calEvent.attendees
        .map((a) => {
          const name = a.name?.trim();
          const email = a.email?.trim();
          if (name && email) return `${name} <mailto:${email}|${email}>`;
          if (email) return `<mailto:${email}|${email}>`;
          return name || "";
        })
        .filter(Boolean)
        .join(", ");
      if (attLine) lines.push(`👥 ${attLine}`);
    }
    if (calEvent.location) {
      const isUrl = /^(https?:\/\/|www\.)/i.test(calEvent.location.trim());
      const loc = isUrl
        ? `<${normalizeUrl(calEvent.location)}|${calEvent.location}>`
        : calEvent.location;
      lines.push(`📍 ${loc}`);
    }
    if (calEvent.meetingUrl) {
      lines.push(`🎥 <${normalizeUrl(calEvent.meetingUrl)}|Join meeting>`);
    }
    if (calEvent.eventUrl) {
      lines.push(`📆 <${normalizeUrl(calEvent.eventUrl)}|Open in Calendar>`);
    }
    const desc = calEvent.description?.trim();
    if (desc) {
      const trimmed = desc.length > 600 ? desc.slice(0, 600).trimEnd() + "…" : desc;
      lines.push("");
      lines.push(`>${trimmed.replace(/\n/g, "\n>")}`);
    }
    lines.push("");
  }

  lines.push(`📋 *Pre-Call Research: ${companyDisplay}*`);
  if (contactDisplay) {
    lines.push(`${contactDisplay}${titleDisplay ? ` — ${titleDisplay}` : ""}`);
  }
  if (research.contactEmail) {
    lines.push(`✉️ <mailto:${research.contactEmail}|${research.contactEmail}>`);
  }
  if (research.contactLinkedIn) {
    lines.push(`🔗 <${normalizeUrl(research.contactLinkedIn)}|LinkedIn>`);
  }

  // Split the brief: the first markdown section (typically
  // "TL;DR — Executive Summary") becomes part of the parent
  // message so Slack readers get tangible value before clicking
  // through. Everything from the second heading onward (Company
  // Snapshot etc.) goes into the threaded reply.
  const briefSplit = splitExecSummary(research.content);
  if (briefSplit.execSummary) {
    lines.push("");
    lines.push(markdownToSlack(briefSplit.execSummary));
  }

  lines.push("");
  lines.push(`<${reportUrl}|View full brief →>`);

  const headerText = lines.join("\n");

  let bodyText = markdownToSlack(briefSplit.rest || research.content);
  let truncated = false;
  if (bodyText.length > SLACK_MESSAGE_CHAR_LIMIT) {
    bodyText = bodyText.slice(0, SLACK_MESSAGE_CHAR_LIMIT - 200);
    bodyText += `\n\n_…brief truncated — <${reportUrl}|view full report>_`;
    truncated = true;
  }

  return { headerText, bodyText, truncated };
}

/**
 * Resolve the target Slack channel id for a user + destination.
 * For DMs we open a fresh IM conversation against the user's
 * slackUserId. Returns the channel id or throws with a friendly
 * error.
 */
export async function resolveSlackTargetChannel(
  client: WebClient,
  destination: "dm" | "channel",
  userSlackUserId: string | null,
  explicitChannelId: string | null
): Promise<string> {
  if (destination === "dm") {
    if (!userSlackUserId) throw new Error("User has no Slack identity for DM delivery");
    const opened = await client.conversations.open({ users: userSlackUserId });
    const dmId = opened.channel?.id;
    if (!dmId) throw new Error("Failed to open Slack DM");
    return dmId;
  }
  if (!explicitChannelId) throw new Error("channelId required for channel destination");
  return explicitChannelId;
}

/**
 * Post a research brief to Slack. Resolves the destination, posts
 * a header + threaded body. Returns the ts of the parent message
 * on success.
 */
export async function postResearchToSlack(opts: {
  userId: string;
  research: ResearchForSlack;
  destination: "dm" | "channel";
  channelId?: string | null;
}): Promise<{ ok: true; ts: string | undefined } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { workspaceId: true, slackUserId: true },
  });
  if (!user?.workspaceId) return { ok: false, error: "no_workspace" };

  const workspace = await prisma.workspace.findUnique({
    where: { id: user.workspaceId },
    select: { botToken: true },
  });
  if (!workspace?.botToken) return { ok: false, error: "no_workspace_token" };

  try {
    const client = getSlackClient(workspace.botToken);
    const channelId = await resolveSlackTargetChannel(
      client,
      opts.destination,
      user.slackUserId,
      opts.channelId ?? null
    );
    const { headerText, bodyText } = buildResearchSlackMessage(opts.research);
    const parentTs = await sendSlackMessage(client, channelId, headerText);
    await sendSlackMessage(client, channelId, bodyText, parentTs);
    return { ok: true, ts: parentTs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/**
 * Post a "we matched a meeting but couldn't enrich" note to Slack
 * so the user knows to look at it manually. Used by the cron when
 * PDL strikes out or brief generation fails.
 */
export async function postEnrichmentFailureNote(opts: {
  userId: string;
  destination: "dm" | "channel";
  channelId?: string | null;
  eventTitle: string;
  eventStartsAt: string;
  reason: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { workspaceId: true, slackUserId: true },
  });
  if (!user?.workspaceId) return { ok: false, error: "no_workspace" };

  const workspace = await prisma.workspace.findUnique({
    where: { id: user.workspaceId },
    select: { botToken: true },
  });
  if (!workspace?.botToken) return { ok: false, error: "no_workspace_token" };

  try {
    const client = getSlackClient(workspace.botToken);
    const channelId = await resolveSlackTargetChannel(
      client,
      opts.destination,
      user.slackUserId,
      opts.channelId ?? null
    );
    const startSec = Math.floor(new Date(opts.eventStartsAt).getTime() / 1000);
    const fallback = new Date(opts.eventStartsAt).toUTCString();
    const timeTok = `<!date^${startSec}^{date_short_pretty} at {time}|${fallback}>`;
    const text =
      `⚠️ *Couldn't auto-research a meeting that matched your pattern*\n` +
      `📅 ${opts.eventTitle}\n` +
      `🕒 ${timeTok}\n\n` +
      `Reason: ${opts.reason}\n` +
      `_Hop into the Pre-Call Research applet to research this prospect manually._`;
    await sendSlackMessage(client, channelId, text);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
