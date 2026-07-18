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

const DETECT_PROMPT = `You are scanning a deal's evidence (call transcripts, emails, Slack activity) for FUTURE follow-UP tasks — commitments and obligations that haven't happened yet. The founder is the seller.

Return ONLY a JSON object:
{
  "tasks": [
    {
      "title": "<short imperative, e.g. 'Send Jerrod the revised pilot scope'>",
      "owner": "founder" | "prospect",
      "dueDate": "YYYY-MM-DD" | null,
      "executeViaSlack": true | false,
      "draftMessage": "<a short founder-voiced Slack message that would execute this, or null>",
      "evidence": "<short VERBATIM quote from the evidence that justifies this task>",
      "rationale": "<one sentence — why this matters now>"
    }
  ]
}

Rules:
- EVIDENCE IS MANDATORY — every task carries a verbatim quote. No quote, no task.
- Only FUTURE work: promises not yet fulfilled, agreed next steps, "I'll send you X", "let's reconnect after Y". Check the LATER evidence before proposing — if a promised item already went out (visible in a later email/Slack/call), skip it.
- owner "founder" = the founder must act. owner "prospect" = the other side promised something — these become watch/chase tasks ("Chase: Dustin's sample calls").
- dueDate: use explicit timing when stated ("by Friday", "after their Aug 10 board meeting" → the day after). When timing is implied but vague ("I'll follow up next week"), estimate. When no timing signal at all, null — the caller defaults it.
- executeViaSlack true only for founder-owned tasks that are naturally a short Slack message to the prospect (follow-ups, nudges, links). Contract redlines and calendar scheduling are not Slack messages.
- draftMessage only when executeViaSlack: 2-4 conversational sentences in the founder's voice, grounded in the thread, no signature.
- Cap at 7 tasks, most consequential first. An empty array is a fine answer.
- Today's date is {{TODAY}}.`;

export interface DetectResult {
  created: Array<{ id: string; title: string; dueAt: string | null }>;
  skippedDupes: number;
}

/**
 * On-demand detection: scan the deal's full evidence for future
 * commitments and materialize them as scheduled DealTasks (rationale
 * carries the verbatim quote; one-click dismiss on the card handles
 * misses). Dedupes against existing non-dismissed tasks by normalized
 * title. Prospect-owned commitments land as "Chase:" watch tasks.
 */
export async function detectDealTasks(
  userId: string,
  dealId: string
): Promise<DetectResult> {
  const [seller, assembled, existing] = await Promise.all([
    loadSellerContext(userId),
    assembleDealEvidence(userId, dealId, { maxChars: 600_000 }),
    prisma.dealTask.findMany({
      where: { dealId },
      select: { title: true, status: true },
    }),
  ]);
  if (!assembled) return { created: [], skippedDupes: 0 };

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const existingTitles = new Set(existing.map((t) => norm(t.title)));

  const prompt = DETECT_PROMPT.replace("{{TODAY}}", new Date().toISOString().slice(0, 10));
  const payload = {
    foundersValueProp: seller.valueProp100w?.substring(0, 1200) || "(none)",
    existingOpenTasks: existing
      .filter((t) => t.status === "scheduled" || t.status === "pinged")
      .map((t) => t.title),
    dealEvidence: assembled.evidence,
  };
  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      { role: "user", content: `${prompt}\n\n---\n\n${JSON.stringify(payload, null, 2)}` },
    ],
  });
  let parsed: {
    tasks?: Array<{
      title?: string;
      owner?: string;
      dueDate?: string | null;
      executeViaSlack?: boolean;
      draftMessage?: string | null;
      evidence?: string;
      rationale?: string;
    }>;
  };
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("Task detection returned unparseable JSON");
  }

  const created: DetectResult["created"] = [];
  let skippedDupes = 0;
  for (const raw of (parsed.tasks || []).slice(0, 7)) {
    const baseTitle = (raw.title || "").trim();
    const evidence = (raw.evidence || "").trim();
    if (!baseTitle || !evidence) continue;
    const isProspect = raw.owner === "prospect";
    const title = isProspect && !/^chase[:\s]/i.test(baseTitle) ? `Chase: ${baseTitle}` : baseTitle;
    if (existingTitles.has(norm(title)) || existingTitles.has(norm(baseTitle))) {
      skippedDupes++;
      continue;
    }
    existingTitles.add(norm(title));
    // Explicit timing wins; vague/no timing defaults to +3 days so the
    // task actually surfaces (null dueAt would sleep forever).
    let dueAt: Date;
    if (raw.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate)) {
      dueAt = new Date(`${raw.dueDate}T17:00:00Z`);
    } else {
      dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    }
    const executeViaSlack = !isProspect && raw.executeViaSlack === true;
    const task = await prisma.dealTask.create({
      data: {
        userId,
        dealId,
        title,
        rationale: `"${evidence.substring(0, 300)}"${raw.rationale ? ` — ${raw.rationale.substring(0, 200)}` : ""}`,
        source: "deal_analysis",
        status: "scheduled",
        dueAt,
        executeVia: executeViaSlack ? "slack_channel" : null,
        draftMessage:
          executeViaSlack && typeof raw.draftMessage === "string" && raw.draftMessage.trim()
            ? raw.draftMessage.trim()
            : null,
      },
    });
    created.push({ id: task.id, title: task.title, dueAt: task.dueAt?.toISOString() ?? null });
  }
  return { created, skippedDupes };
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
        unfurl_links: false,
        unfurl_media: false,
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
  taskId: string,
  /** Edited message from the preview overlay — persisted onto the
   *  task before sending so the proof entry logs what actually went. */
  messageOverride?: string
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
  const draft = (messageOverride || task.draftMessage || "").trim();
  if (!draft) return { ok: false, reason: "no_draft" };
  if (messageOverride && messageOverride.trim() !== (task.draftMessage || "").trim()) {
    await prisma.dealTask.update({
      where: { id: task.id },
      data: { draftMessage: messageOverride.trim() },
    });
  }
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
