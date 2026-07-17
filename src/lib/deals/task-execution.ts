import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { getSlackClient } from "@/lib/slack/client";
import { loadSellerContext } from "@/lib/seller-context";
import { assembleDealEvidence } from "@/lib/business-cases/generate";
import { resolveSlackTarget, recordDealSlackPost } from "./triage";
import { isAlertEnabled, alertFooterBlock } from "./alert-prefs";

/**
 * Future deal tasks — the Slack execution loop (autopilot Phase 5,
 * first slice). A scheduled task (dueAt set, executeVia
 * "slack_channel") sleeps until due; the 5-min cron then:
 *
 *   1. drafts the founder-voiced message (LLM over deal evidence)
 *      unless the founder pre-wrote one — saved back onto the task so
 *      what's previewed is exactly what sends;
 *   2. pings the founder: "⚡ Proposed Task Execution — Slack" with
 *      the draft and a one-touch "🚀 Do it" link;
 *   3. the Do-it link sends the draft into the deal's LINKED channel
 *      AS THE FOUNDER (user token; bot fallback), logs a timeline
 *      entry as proof, and marks the task done.
 *
 * status flow: scheduled → pinged (ping posted, waiting on the human)
 * → done | dismissed. Pinged tasks never re-ping.
 */

const APP_URL = () =>
  (process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io").replace(/\/$/, "");

const DRAFT_PROMPT = `You are drafting a short Slack message the FOUNDER will send in the shared Slack channel with a prospect, to execute a follow-up task. Write it in the founder's voice — warm, direct, zero corporate filler.

Return ONLY a JSON object: { "message": "<the Slack message>" }

Rules:
- Ground it in the deal evidence: reference the real thread — what was last discussed, what was promised, names of people. Never invent facts.
- Serve the TASK: if the task says "follow up on the proposal", the message nudges exactly that.
- 2-5 sentences. Plain conversational Slack text — no markdown headers, no bullet lists, no signature, no "Hi [Name]" placeholder (use the real first name if the evidence names one, else open without a greeting).
- End with something easy to respond to (a question or a light call to action).`;

export async function generateTaskDraft(opts: {
  userId: string;
  dealId: string;
  taskTitle: string;
  rationale?: string | null;
}): Promise<string> {
  const [seller, assembled] = await Promise.all([
    loadSellerContext(opts.userId),
    assembleDealEvidence(opts.userId, opts.dealId),
  ]);
  const payload = {
    task: opts.taskTitle,
    taskRationale: opts.rationale || "(none)",
    foundersValueProp: seller.valueProp100w?.substring(0, 1200) || "(none)",
    dealEvidence: (assembled?.evidence || "(no evidence yet)").slice(-60_000),
  };
  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      { role: "user", content: `${DRAFT_PROMPT}\n\n---\n\n${JSON.stringify(payload, null, 2)}` },
    ],
  });
  let parsed: { message?: string };
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("Task draft generator returned unparseable JSON");
  }
  const message = (parsed.message || "").trim();
  if (!message) throw new Error("Task draft came back empty");
  return message;
}

/**
 * Cron sweep: due scheduled tasks → draft + "⚡ Proposed Task
 * Execution" ping. Capped per tick (each undrafted task costs an LLM
 * call). Tasks whose deal left play are expired quietly.
 */
export async function sweepDueDealTasks(maxPings = 3): Promise<number> {
  const due = await prisma.dealTask.findMany({
    where: {
      status: "scheduled",
      dueAt: { lte: new Date() },
    },
    orderBy: { dueAt: "asc" },
    take: 10,
    include: {
      deal: {
        select: {
          id: true, userId: true, name: true, companyName: true, status: true,
          slackChannelId: true, slackChannelName: true,
        },
      },
    },
  });
  if (due.length === 0) return 0;

  let pinged = 0;
  for (const task of due) {
    if (pinged >= maxPings) break;
    try {
      // A dead deal's follow-ups die with it.
      if (task.deal.status === "dismissed" || task.deal.status === "closed_lost" || task.deal.status === "closed_won") {
        await prisma.dealTask.update({
          where: { id: task.id },
          data: { status: "expired", resolvedAt: new Date() },
        });
        continue;
      }
      if (!(await isAlertEnabled(task.deal.userId, "task_execution"))) continue;
      const target = await resolveSlackTarget(task.deal.userId);
      if (!target) continue;

      // Draft once, at ping time, and persist — the Do-it link sends
      // EXACTLY what was previewed.
      let draft = (task.draftMessage || "").trim();
      if (!draft && task.executeVia === "slack_channel") {
        draft = await generateTaskDraft({
          userId: task.deal.userId,
          dealId: task.dealId,
          taskTitle: task.title,
          rationale: task.rationale,
        });
        await prisma.dealTask.update({
          where: { id: task.id },
          data: { draftMessage: draft },
        });
      }

      const appUrl = APP_URL();
      const company = task.deal.companyName || task.deal.name;
      const canExecute = task.executeVia === "slack_channel" && !!task.deal.slackChannelId;
      const doUrl = `${appUrl}/deals/${task.dealId}/tasks/${task.id}/do`;
      const dismissUrl = `${appUrl}/deals/${task.dealId}/tasks/${task.id}/dismiss`;
      const links = [
        ...(canExecute
          ? [`<${doUrl}|🚀 Do it — send to #${task.deal.slackChannelName || "channel"} as you>`]
          : []),
        `<${appUrl}/deals/${task.dealId}|Open deal →>`,
        `<${dismissUrl}|✕ Dismiss task>`,
      ].join("  ·  ");

      const posted = await target.client.chat.postMessage({
        channel: target.channelId,
        mrkdwn: true,
        text: `Proposed task execution: ${task.title} (${company})`,
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: `⚡ Proposed Task Execution — Slack` },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `*${company}* — ${task.title}` +
                (task.rationale ? `\n_${task.rationale}_` : "") +
                (draft
                  ? `\n\n*Ready to send${task.deal.slackChannelName ? ` to #${task.deal.slackChannelName}` : ""}:*\n> ${draft.replace(/\n/g, "\n> ")}`
                  : "") +
                (!canExecute
                  ? `\n\n⚠️ No Slack channel is linked to this deal — open it to attach one, then this executes with a touch.`
                  : ""),
            },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: links },
          },
          alertFooterBlock("task_execution", appUrl),
        ],
      });
      await recordDealSlackPost({
        userId: task.deal.userId,
        dealId: task.dealId,
        kind: "task_execution",
        sourceRef: task.id,
        channelId: target.channelId,
        ts: posted.ts || "",
      });
      await prisma.dealTask.update({
        where: { id: task.id },
        data: { status: "pinged" },
      });
      pinged++;
      console.log(`[task-execution] pinged task ${task.id} (${task.title}) on deal ${task.dealId}`);
    } catch (err) {
      console.error(`[task-execution] ping failed for task ${task.id}:`, err);
    }
  }
  return pinged;
}

export interface ExecuteResult {
  ok: boolean;
  reason?: string;
}

/**
 * The "Do it" — send the task's draft into the deal's linked channel
 * as the founder (user token with chat:write; bot token fallback),
 * log the timeline entry as proof, mark the task done. Idempotent:
 * an already-resolved task is a no-op.
 */
export async function executeDealTaskViaSlack(
  actingUserId: string,
  taskId: string
): Promise<ExecuteResult> {
  const task = await prisma.dealTask.findUnique({
    where: { id: taskId },
    include: {
      deal: {
        select: {
          id: true, userId: true, name: true, companyName: true,
          slackChannelId: true, slackChannelName: true,
        },
      },
    },
  });
  if (!task) return { ok: false, reason: "not_found" };
  // Owner-only: the message sends AS the founder.
  if (task.deal.userId !== actingUserId) return { ok: false, reason: "forbidden" };
  if (task.status === "done" || task.status === "dismissed") {
    return { ok: true, reason: "already_resolved" };
  }
  const draft = (task.draftMessage || "").trim();
  if (!draft) return { ok: false, reason: "no_draft" };
  if (!task.deal.slackChannelId) return { ok: false, reason: "no_channel" };

  const user = await prisma.user.findUnique({
    where: { id: task.deal.userId },
    select: { workspaceId: true, slackUserToken: true, slackUserScopes: true },
  });
  if (!user?.workspaceId) return { ok: false, reason: "no_workspace" };
  const ws = await prisma.workspace.findUnique({
    where: { id: user.workspaceId },
    select: { botToken: true },
  });
  if (!ws?.botToken) return { ok: false, reason: "no_workspace" };

  const canSendAsUser =
    !!user.slackUserToken && (user.slackUserScopes || "").includes("chat:write");
  const client = getSlackClient(
    canSendAsUser ? user.slackUserToken! : ws.botToken
  );
  try {
    await client.chat.postMessage({
      channel: task.deal.slackChannelId,
      text: draft,
      // as_user is implicit on a user token; bot fallback posts as Mikey.
    });
  } catch (err) {
    console.error(`[task-execution] send failed for task ${taskId}:`, err);
    return { ok: false, reason: "send_failed" };
  }

  // Proof: the sent message lands on the timeline like any other
  // channel activity (the channel sync would eventually pick it up,
  // but the explicit entry carries the task linkage).
  const entry = await prisma.dealTimelineEntry.create({
    data: {
      dealId: task.dealId,
      type: "slack_message",
      title: `Task executed: ${task.title}`,
      content: `Sent to #${task.deal.slackChannelName || "channel"}${canSendAsUser ? " as the founder" : " via Mikey"}:\n\n${draft}`,
      entryDate: new Date(),
      metadata: JSON.stringify({
        auto_logged: true,
        source: "task_execution",
        dealTaskId: task.id,
        sentAsUser: canSendAsUser,
      }),
    },
  });
  await prisma.dealTask.update({
    where: { id: task.id },
    data: {
      status: "done",
      executedAt: new Date(),
      resolvedAt: new Date(),
      proofEntryId: entry.id,
    },
  });
  return { ok: true };
}
