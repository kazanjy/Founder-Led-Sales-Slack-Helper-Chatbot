import type { WebClient } from "@slack/web-api";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db";
import { sendSlackMessage, getThreadMessages } from "./client";
import { markdownToSlack } from "./markdown";
import { appendFileContext, detectionText } from "./file-context";
import { runCoachingAgent } from "@/lib/agents/coaching/run";

/**
 * Decide whether an inbound Slack message should be handled by the
 * coaching tool-using agent (instead of Chatbase). Heuristic: the
 * cleaned message text (plus prior thread context when applicable)
 * contains at least one coaching-flavored keyword AND the context
 * user has at least one non-draft coaching session in their account.
 *
 * The trigger phrases are narrow on purpose — we want to bias toward
 * "obvious coaching question" early on and let everything else fall
 * through to Chatbase. Will widen once we see the false-positive
 * rate in production.
 *
 * Returns true when the message was handled. Any exception inside
 * the handler is logged and we return false so a broken coaching
 * agent doesn't black-hole the user's message.
 */

export const COACHING_TRIGGERS: RegExp[] = [
  /\bcoaching\b/i,
  /\bsession\b/i,
  /\bsprint(?:\s*(?:review|plan))?\b/i,
  /\bgoals?\b/i,
  /\btasks?\b/i,
  /\bsub[-\s]?tasks?\b/i,
  /\btakeaways?\b/i,
  /\bsynth?esi[sz]e\b/i,
  /\bnotes? from\b/i,
  /\bwhere did we leave off\b/i,
  /\bwhat'?s next\b/i,
  /\bwhat (?:is|are)? our (?:latest )?(?:arr|mrr|customer count|customers|pipeline|metrics?)\b/i,
  /\blatest (?:arr|mrr|customer count|metric|metrics)\b/i,
  /\bgtm maturity\b/i,
  /\bmaturity stage\b/i,
  /\b(?:up next|next goals?)\b/i,
  /\bcatch me up\b/i,
];

const MAX_THREAD_HISTORY = 12;

export async function tryHandleWithCoachingAgent(opts: {
  speakerUserId: string;
  text: string;
  // Extracted text from any attached files (empty when none). Folded
  // into coaching-keyword detection AND the agent message.
  fileContext?: string;
  client: WebClient;
  channel: string;
  threadTs: string | undefined;
  botUserId: string | null;
  messageTs: string;
  threadRootTs: string | undefined;
}): Promise<boolean> {
  const { speakerUserId, text, fileContext, client, channel, threadTs, botUserId, messageTs, threadRootTs } = opts;

  try {
    const cleaned = stripSlackMentions(text || "").trim();
    if (!cleaned && !(fileContext || "").trim()) return false;
    const cleanedForDetection = detectionText(cleaned, fileContext);

    // Same channel-claim swap as the deal router: in a claimed
    // channel Mikey acts on behalf of the channel owner, not the
    // current speaker (who may be a prospect / teammate with no
    // coaching data of their own).
    const channelClaim = await prisma.channelClaim.findUnique({
      where: { slackChannelId: channel },
      select: { claimedByUserId: true },
    });
    const contextUserId = channelClaim?.claimedByUserId || speakerUserId;

    // Pull thread context for both keyword detection AND agent
    // history — a follow-up like "what's our ARR?" inside an
    // ongoing coaching thread should still route to the agent even
    // when its own text doesn't trigger.
    let priorThread: Array<{ role: "user" | "assistant"; text: string }> = [];
    if (threadRootTs && threadRootTs !== messageTs) {
      try {
        const raw = await getThreadMessages(client, channel, threadRootTs);
        for (const m of raw) {
          if (m.ts === messageTs) continue;
          const txt = stripSlackMentions(m.text || "").trim();
          if (!txt) continue;
          const role = m.bot_id || (botUserId && m.user === botUserId) ? "assistant" : "user";
          priorThread.push({ role, text: txt });
        }
        if (priorThread.length > MAX_THREAD_HISTORY) {
          priorThread = priorThread.slice(-MAX_THREAD_HISTORY);
        }
      } catch (err) {
        console.error("[slack→coaching-agent] failed to load thread history:", err);
      }
    }

    const triggered =
      hasCoachingKeyword(cleanedForDetection) ||
      priorThread.some((m) => m.role === "user" && hasCoachingKeyword(m.text));
    if (!triggered) return false;

    // Only fire if the user actually has any coaching activity to
    // talk about — otherwise we'd be answering "what was the last
    // session?" with "you don't have any sessions yet", which is
    // wasted spend and a worse UX than Chatbase's generic answer.
    const sessionCount = await prisma.coachingSession.count({
      where: { userId: contextUserId, NOT: { notes: "(draft)" } },
    });
    if (sessionCount === 0) {
      console.log(
        `[slack→coaching-agent] keyword fired but contextUser=${contextUserId} has 0 sessions; falling through`
      );
      return false;
    }

    console.log(
      `[slack→coaching-agent] user=${contextUserId} text="${cleaned.substring(0, 140)}" routing to coaching agent`
    );
    await sendSlackMessage(
      client,
      channel,
      `_:books: Looking at your coaching history…_`,
      threadTs
    );

    const conversationHistory: ChatCompletionMessageParam[] = priorThread.map((m) => ({
      role: m.role,
      content: m.text,
    }));
    const result = await runCoachingAgent({
      userId: contextUserId,
      userMessage: appendFileContext(cleaned, fileContext),
      conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
    });

    const appBase = (process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io").replace(/\/$/, "");
    const linkLine = `<${appBase}/coaching-history|:books: Open Coaching in Mikey ↗>`;
    const slackReply = `${linkLine}\n\n${markdownToSlack(result.reply)}`;
    await sendSlackMessage(client, channel, slackReply, threadTs);

    console.log(
      `[slack→coaching-agent] user=${contextUserId} turns=${result.turns} tools=${result.trace.length}${result.hitTurnCap ? " hitTurnCap" : ""}`
    );
    return true;
  } catch (err) {
    console.error("[slack→coaching-agent] handler threw, falling through:", err);
    return false;
  }
}

export function hasCoachingKeyword(text: string): boolean {
  return COACHING_TRIGGERS.some((re) => re.test(text));
}

function stripSlackMentions(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(/<#[A-Z0-9]+(?:\|[^>]*)?>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
