import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getSlackClient, sendSlackMessage } from "@/lib/slack/client";

/**
 * POST /api/pre-call-planning/research/[id]/send-to-slack
 *
 * Posts the pre-call research brief into a Slack channel the user
 * picked from /api/slack/my-channels. We send a compact header with
 * the prospect's identity + links, then the brief body translated
 * to Slack mrkdwn (best-effort) inside a follow-up message in the
 * same channel so the header stays scannable.
 */

interface Body {
  destination?: "dm" | "channel";
  channelId?: string;
  channelName?: string;
  saveAsPreferred?: boolean;
}

// PDL output is lowercase; mirror the page's render-time title-case
// so the Slack message reads consistently with the in-app view.
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
function toTitleCase(s: string | null | undefined): string {
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

// Convert common markdown to Slack mrkdwn. Slack accepts a small
// subset: *bold*, _italic_, ~strike~, `code`, ```block```, > quote,
// • bullets, and <url|label> links. Headers / tables don't render
// natively, so we downgrade them to bold lines.
function markdownToSlack(md: string): string {
  return md
    // Headers → bold
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    // [text](url) → <url|text>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
    // **bold** → *bold*
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    // - / * bullets → •
    .replace(/^[\-*]\s+/gm, "• ")
    // Trim runs of blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SLACK_MESSAGE_CHAR_LIMIT = 35000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!user.workspaceId) {
    return NextResponse.json({ error: "no_workspace" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as Body;
  const destination = body.destination === "dm" ? "dm" : "channel";

  const [research, workspace, userRow] = await Promise.all([
    prisma.preCallResearch.findFirst({
      where: { id, userId: user.id },
    }),
    prisma.workspace.findUnique({
      where: { id: user.workspaceId },
      select: { botToken: true },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { slackUserId: true },
    }),
  ]);

  if (!research) {
    return NextResponse.json({ error: "Research not found" }, { status: 404 });
  }
  if (!workspace?.botToken) {
    return NextResponse.json({ error: "no_workspace_token" }, { status: 403 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
  const reportUrl = `${appUrl}/pre-call-planning/research?id=${research.id}`;

  const companyDisplay = toTitleCase(research.companyName);
  const contactDisplay = toTitleCase(research.contactName);
  const titleDisplay = toTitleCase(research.contactTitle);

  const headerLines: string[] = [
    `📋 *Pre-Call Research: ${companyDisplay}*`,
  ];
  if (contactDisplay) {
    headerLines.push(
      `${contactDisplay}${titleDisplay ? ` — ${titleDisplay}` : ""}`
    );
  }
  if (research.contactEmail) {
    headerLines.push(`✉️ ${research.contactEmail}`);
  }
  if (research.contactLinkedIn) {
    headerLines.push(`🔗 <${research.contactLinkedIn}|LinkedIn>`);
  }
  headerLines.push("");
  headerLines.push(`<${reportUrl}|View full brief →>`);
  const headerText = headerLines.join("\n");

  let bodyText = markdownToSlack(research.content);
  let truncated = false;
  if (bodyText.length > SLACK_MESSAGE_CHAR_LIMIT) {
    bodyText = bodyText.slice(0, SLACK_MESSAGE_CHAR_LIMIT - 200);
    bodyText += `\n\n_…brief truncated — <${reportUrl}|view full report>_`;
    truncated = true;
  }

  try {
    const client = getSlackClient(workspace.botToken);

    // Resolve where to actually post. DM mode opens a conversation
    // with the user's slackUserId and uses the returned channel id;
    // channel mode trusts the caller's channelId.
    let targetChannelId = body.channelId || "";
    if (destination === "dm") {
      if (!userRow?.slackUserId) {
        return NextResponse.json({ error: "no_slack_dm" }, { status: 400 });
      }
      const opened = await client.conversations.open({ users: userRow.slackUserId });
      const dmId = opened.channel?.id;
      if (!dmId) {
        return NextResponse.json({ error: "Failed to open DM" }, { status: 502 });
      }
      targetChannelId = dmId;
    }

    if (!targetChannelId) {
      return NextResponse.json({ error: "channelId required" }, { status: 400 });
    }

    // Header first so it's the parent message; body posts as a
    // threaded reply so the channel stays scannable.
    const parentTs = await sendSlackMessage(client, targetChannelId, headerText);
    await sendSlackMessage(client, targetChannelId, bodyText, parentTs);

    // Persist the channel as the user's preferred destination when
    // they explicitly asked us to.
    if (destination === "channel" && body.saveAsPreferred && body.channelId) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          preferredResearchSlackChannelId: body.channelId,
          preferredResearchSlackChannelName: body.channelName || null,
        },
      });
    }

    return NextResponse.json({ ok: true, truncated });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[research/send-to-slack] post failed:", message);
    const friendly =
      /not_in_channel/.test(message)
        ? "Mikey isn't a member of that channel. Invite the bot, then try again."
        : /channel_not_found/.test(message)
          ? "Channel not found or not visible to Mikey."
          : "Failed to post to Slack. Try a different channel.";
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
