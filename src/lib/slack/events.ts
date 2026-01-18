import { prisma } from "@/lib/db";
import { getSlackClient, sendSlackMessage, getThreadMessages } from "./client";
import { sendToChatbase } from "@/lib/chatbase/client";

interface SlackEventPayload {
  team_id: string;
  event: {
    type: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    channel_type?: string;
  };
}

/**
 * Handle incoming Slack events
 */
export async function handleSlackEvent(payload: SlackEventPayload) {
  const { team_id, event } = payload;

  // Ignore bot messages to prevent loops
  if (event.bot_id) {
    return;
  }

  // Handle app_mention events (in channels)
  if (event.type === "app_mention") {
    await handleMention(team_id, event);
    return;
  }

  // Handle direct messages
  if (event.type === "message" && event.channel_type === "im") {
    await handleDirectMessage(team_id, event);
    return;
  }

  // Handle thread replies (continuing a conversation)
  if (event.type === "message" && event.thread_ts && event.thread_ts !== event.ts) {
    await handleThreadReply(team_id, event);
    return;
  }
}

/**
 * Handle @mention in a channel
 */
async function handleMention(
  teamId: string,
  event: SlackEventPayload["event"]
) {
  const { user, text, channel, ts } = event;
  if (!user || !text || !channel || !ts) return;

  // Get the workspace
  const workspace = await prisma.workspace.findUnique({
    where: { slackTeamId: teamId },
  });

  if (!workspace) {
    console.error("Workspace not found:", teamId);
    return;
  }

  // Get or create user
  const dbUser = await getOrCreateUser(workspace.id, user);

  // Check if user can send messages (license/trial check)
  const canSend = await checkUserCanSendMessage(dbUser);
  if (!canSend.allowed) {
    const client = getSlackClient(workspace.botToken);
    await sendSlackMessage(client, channel, canSend.message, ts);
    return;
  }

  // Strip the bot mention from the message
  const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();

  if (!cleanText) {
    const client = getSlackClient(workspace.botToken);
    await sendSlackMessage(
      client,
      channel,
      "Hey! Ask me anything about founder-led sales. Just @mention me with your question.",
      ts
    );
    return;
  }

  // Process the message
  await processMessage(workspace, dbUser, channel, ts, cleanText);
}

/**
 * Handle direct message
 */
async function handleDirectMessage(
  teamId: string,
  event: SlackEventPayload["event"]
) {
  const { user, text, channel, ts, thread_ts } = event;
  if (!user || !text || !channel || !ts) return;

  // Get the workspace
  const workspace = await prisma.workspace.findUnique({
    where: { slackTeamId: teamId },
  });

  if (!workspace) {
    console.error("Workspace not found:", teamId);
    return;
  }

  // Get or create user
  const dbUser = await getOrCreateUser(workspace.id, user);

  // Check if user can send messages
  const canSend = await checkUserCanSendMessage(dbUser);
  if (!canSend.allowed) {
    const client = getSlackClient(workspace.botToken);
    await sendSlackMessage(client, channel, canSend.message, thread_ts || ts);
    return;
  }

  // Use thread_ts if this is a reply, otherwise use ts as the thread
  const threadTs = thread_ts || ts;

  await processMessage(workspace, dbUser, channel, threadTs, text, ts);
}

/**
 * Handle replies within a thread
 */
async function handleThreadReply(
  teamId: string,
  event: SlackEventPayload["event"]
) {
  const { user, text, channel, ts, thread_ts } = event;
  if (!user || !text || !channel || !ts || !thread_ts) return;

  // Check if we have a conversation for this thread
  const workspace = await prisma.workspace.findUnique({
    where: { slackTeamId: teamId },
  });

  if (!workspace) return;

  // Check if this is a thread we're participating in
  const conversation = await prisma.conversation.findUnique({
    where: {
      workspaceId_slackChannelId_slackThreadTs: {
        workspaceId: workspace.id,
        slackChannelId: channel,
        slackThreadTs: thread_ts,
      },
    },
  });

  // Only respond to threads we've already joined
  if (!conversation) return;

  const dbUser = await getOrCreateUser(workspace.id, user);

  // Check if user can send messages
  const canSend = await checkUserCanSendMessage(dbUser);
  if (!canSend.allowed) {
    const client = getSlackClient(workspace.botToken);
    await sendSlackMessage(client, channel, canSend.message, thread_ts);
    return;
  }

  await processMessage(workspace, dbUser, channel, thread_ts, text, ts);
}

/**
 * Process a message and generate a response
 */
async function processMessage(
  workspace: { id: string; botToken: string; botUserId: string | null },
  user: { id: string; slackUserId: string },
  channel: string,
  threadTs: string,
  text: string,
  messageTs?: string
) {
  const client = getSlackClient(workspace.botToken);

  // Get or create conversation
  let conversation = await prisma.conversation.findUnique({
    where: {
      workspaceId_slackChannelId_slackThreadTs: {
        workspaceId: workspace.id,
        slackChannelId: channel,
        slackThreadTs: threadTs,
      },
    },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        slackChannelId: channel,
        slackThreadTs: threadTs,
        firstMessagePreview: text.substring(0, 100),
      },
    });
  }

  // Save user message
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      userId: user.id,
      role: "USER",
      content: text,
      slackMessageTs: messageTs,
    },
  });

  // Get conversation history for context
  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: 20, // Last 20 messages for context
  });

  const chatbaseHistory = history.slice(0, -1).map((msg: { role: string; content: string }) => ({
    role: msg.role.toLowerCase() as "user" | "assistant",
    content: msg.content,
  }));

  try {
    // Get response from Chatbase
    const { response, conversationId: chatbaseConvId } = await sendToChatbase(
      text,
      conversation.chatbaseConversationId || undefined,
      chatbaseHistory
    );

    // Update conversation with Chatbase ID if we got one
    if (chatbaseConvId && !conversation.chatbaseConversationId) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { chatbaseConversationId: chatbaseConvId },
      });
    }

    // Send response to Slack
    const responseTs = await sendSlackMessage(client, channel, response, threadTs);

    // Save assistant message
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: response,
        slackMessageTs: responseTs,
      },
    });

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        messageCount: { increment: 2 },
        lastMessageAt: new Date(),
      },
    });

    // Increment user's daily message count
    await prisma.user.update({
      where: { id: user.id },
      data: {
        messagesToday: { increment: 1 },
        trialMessagesRemaining: {
          decrement: 1,
        },
      },
    });
  } catch (error) {
    console.error("Error processing message:", error);
    await sendSlackMessage(
      client,
      channel,
      "Sorry, I encountered an error processing your message. Please try again.",
      threadTs
    );
  }
}

/**
 * Get or create a user record
 */
async function getOrCreateUser(workspaceId: string, slackUserId: string) {
  let user = await prisma.user.findUnique({
    where: {
      slackUserId_workspaceId: {
        slackUserId,
        workspaceId,
      },
    },
  });

  if (!user) {
    // Get global settings for trial defaults
    const settings = await prisma.globalSettings.findUnique({
      where: { id: "global" },
    });

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    const trialMessages =
      workspace?.trialMessages ?? settings?.defaultTrialMessages ?? 50;

    user = await prisma.user.create({
      data: {
        slackUserId,
        workspaceId,
        trialStartedAt: new Date(),
        trialMessagesRemaining: trialMessages,
        licenseStatus: "TRIAL",
      },
    });
  }

  return user;
}

/**
 * Check if user can send a message (license/trial/rate limit check)
 */
async function checkUserCanSendMessage(
  user: {
    id: string;
    licenseStatus: string;
    trialMessagesRemaining: number;
    trialStartedAt: Date | null;
    messagesToday: number;
    messageCountResetAt: Date;
    workspaceId: string;
  }
): Promise<{ allowed: boolean; message: string }> {
  // Reset daily count if needed
  const now = new Date();
  const resetAt = new Date(user.messageCountResetAt);
  if (now.toDateString() !== resetAt.toDateString()) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        messagesToday: 0,
        messageCountResetAt: now,
      },
    });
    user.messagesToday = 0;
  }

  // Get settings
  const settings = await prisma.globalSettings.findUnique({
    where: { id: "global" },
  });

  const workspace = await prisma.workspace.findUnique({
    where: { id: user.workspaceId },
  });

  const dailyLimit = workspace?.dailyMessageLimit ?? settings?.defaultDailyMessageLimit ?? 1000;
  const trialDays = workspace?.trialDays ?? settings?.defaultTrialDays ?? 14;

  // Check rate limit
  if (user.messagesToday >= dailyLimit) {
    return {
      allowed: false,
      message: `You've reached your daily message limit (${dailyLimit} messages). Try again tomorrow!`,
    };
  }

  // If user is actively licensed, allow
  if (user.licenseStatus === "ACTIVE") {
    return { allowed: true, message: "" };
  }

  // Check trial status
  if (user.licenseStatus === "TRIAL") {
    // Check days
    const trialStart = user.trialStartedAt || new Date();
    const daysSinceStart = Math.floor(
      (now.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24)
    );
    const trialDaysRemaining = trialDays - daysSinceStart;

    // Check messages
    const trialMessagesRemaining = user.trialMessagesRemaining;

    // Trial ends when BOTH days and messages are exhausted
    if (trialDaysRemaining <= 0 && trialMessagesRemaining <= 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: { licenseStatus: "EXPIRED" },
      });

      return {
        allowed: false,
        message:
          "Your trial has ended. To continue using Mikey, you'll need a license. " +
          "In the meantime, someone with a license can ask questions on your behalf. " +
          "Ready to upgrade? Visit your dashboard to get started!",
      };
    }

    return { allowed: true, message: "" };
  }

  // User is expired or suspended
  return {
    allowed: false,
    message:
      "You need a license to ask Mikey questions. " +
      "In the meantime, someone with a license can ask questions on your behalf. " +
      "Ready to get started? Visit your dashboard!",
  };
}
