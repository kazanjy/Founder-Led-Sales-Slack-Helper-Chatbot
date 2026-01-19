import { prisma } from "@/lib/db";
import { getSlackClient, sendSlackMessage } from "./client";
import { sendToChatbase } from "@/lib/chatbase/client";
import { markdownToSlack } from "./markdown";

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
    tab?: string;
  };
}

/**
 * Handle incoming Slack events
 */
export async function handleSlackEvent(payload: SlackEventPayload) {
  const { team_id, event } = payload;

  console.log("handleSlackEvent called:", { team_id, eventType: event.type, bot_id: event.bot_id });

  // Ignore bot messages to prevent loops
  if (event.bot_id) {
    console.log("Ignoring bot message");
    return;
  }

  // Handle app_mention events (in channels)
  if (event.type === "app_mention") {
    console.log("Routing to handleMention");
    await handleMention(team_id, event);
    return;
  }

  // Handle direct messages
  if (event.type === "message" && event.channel_type === "im") {
    await handleDirectMessage(team_id, event);
    return;
  }

  // Handle App Home opened
  if (event.type === "app_home_opened" && event.tab === "home") {
    await handleAppHomeOpened(team_id, event);
    return;
  }

  // Handle thread replies (continuing a conversation)
  if (event.type === "message" && event.thread_ts && event.thread_ts !== event.ts) {
    await handleThreadReply(team_id, event);
    return;
  }
}

/**
 * Handle App Home opened event
 */
async function handleAppHomeOpened(
  teamId: string,
  event: SlackEventPayload["event"]
) {
  const { user } = event;
  if (!user) return;

  const workspace = await prisma.workspace.findUnique({
    where: { slackTeamId: teamId },
  });

  if (!workspace) {
    console.error("Workspace not found for App Home:", teamId);
    return;
  }

  const client = getSlackClient(workspace.botToken);

  // Get user info for personalization
  const dbUser = await prisma.user.findUnique({
    where: {
      slackUserId_workspaceId: {
        slackUserId: user,
        workspaceId: workspace.id,
      },
    },
  });

  // Build the App Home view
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "👋 Welcome to Mikey!",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "I'm your 🌊 Founder-Led Sales assistant, here to help you with everything Pete can help you with - sales strategies, outreach, objection handling, and more.",
      },
    },
    {
      type: "divider",
    },
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🚀 Getting Started",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Step 1: Add me to a channel*\nType `/invite @Mikey` in any channel where you want to use me.",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Step 2: Ask me anything*\nMention me with your question: `@Mikey how do I handle pricing objections?`",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Step 3: Or DM me directly*\nClick the *Messages* tab above to chat with me privately.",
      },
    },
    {
      type: "divider",
    },
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "💡 What I can help with",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "• Crafting cold outreach messages\n• Handling objections\n• Pricing strategy advice\n• Sales call preparation\n• Follow-up sequences\n• Founder-led sales strategies",
      },
    },
  ];

  // Add trial/license status if user exists
  if (dbUser) {
    let statusText = "";
    if (dbUser.licenseStatus === "ACTIVE") {
      statusText = "✅ *Status:* Licensed";
    } else if (dbUser.licenseStatus === "TRIAL") {
      const trialStart = dbUser.trialStartedAt || new Date();
      const daysSinceStart = Math.floor(
        (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24)
      );
      const daysRemaining = Math.max(0, 7 - daysSinceStart);
      statusText = `🎁 *Status:* Trial (${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} remaining)`;
    } else {
      statusText = "⏰ *Status:* Trial ended";
    }

    blocks.push(
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: statusText,
        },
      }
    );
  }

  blocks.push(
    {
      type: "divider",
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Here's to some founder-led selling success! 🚀",
        },
      ],
    } as typeof blocks[number]
  );

  try {
    await client.views.publish({
      user_id: user,
      view: {
        type: "home",
        blocks,
      },
    });
  } catch (error) {
    console.error("Error publishing App Home:", error);
  }
}

/**
 * Handle @mention in a channel
 */
async function handleMention(
  teamId: string,
  event: SlackEventPayload["event"]
) {
  console.log("handleMention started:", { teamId, event });

  const { user, text, channel, ts } = event;
  if (!user || !text || !channel || !ts) {
    console.log("Missing required fields:", { user, text, channel, ts });
    return;
  }

  // Get the workspace
  console.log("Looking up workspace:", teamId);
  const workspace = await prisma.workspace.findUnique({
    where: { slackTeamId: teamId },
  });

  if (!workspace) {
    console.error("Workspace not found:", teamId);
    return;
  }
  console.log("Workspace found:", workspace.id);

  // Get or create user
  const dbUser = await getOrCreateUser(workspace.id, user);
  console.log("User:", dbUser.id);

  // Check if user can send messages (license/trial check)
  const canSend = await checkUserCanSendMessage(dbUser);
  console.log("canSend:", canSend);
  const client = getSlackClient(workspace.botToken);

  if (!canSend.allowed) {
    await sendSlackMessage(client, channel, canSend.message, ts);
    return;
  }

  // Send welcome message for first-time users
  if (canSend.welcomeMessage) {
    await sendSlackMessage(client, channel, canSend.welcomeMessage, ts);
  }

  // Strip the bot mention from the message
  const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();
  console.log("Clean text:", cleanText);

  if (!cleanText) {
    await sendSlackMessage(
      client,
      channel,
      "Hey! Ask me anything about founder-led sales. Just @mention me with your question.",
      ts
    );
    return;
  }

  // Process the message
  console.log("Calling processMessage");
  await processMessage(workspace, dbUser, channel, ts, cleanText);
  console.log("processMessage completed");
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
  const client = getSlackClient(workspace.botToken);
  const threadTs = thread_ts || ts;

  if (!canSend.allowed) {
    await sendSlackMessage(client, channel, canSend.message, threadTs);
    return;
  }

  // Send welcome message for first-time users
  if (canSend.welcomeMessage) {
    await sendSlackMessage(client, channel, canSend.welcomeMessage, threadTs);
  }

  await processMessage(workspace, dbUser, channel, threadTs, text, ts);
}

/**
 * Handle replies within a thread
 * Only responds if the user @mentions Mikey (to avoid interrupting human conversations)
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

  // Only respond if the user @mentioned Mikey
  // This prevents Mikey from interrupting human-to-human conversations in threads
  const botMention = workspace.botUserId ? `<@${workspace.botUserId}>` : null;
  if (!botMention || !text.includes(botMention)) {
    return; // Not mentioned, don't respond
  }

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
  const client = getSlackClient(workspace.botToken);

  if (!canSend.allowed) {
    await sendSlackMessage(client, channel, canSend.message, thread_ts);
    return;
  }

  // Send welcome message for first-time users (rare in thread replies, but possible)
  if (canSend.welcomeMessage) {
    await sendSlackMessage(client, channel, canSend.welcomeMessage, thread_ts);
  }

  // Strip the bot mention from the message
  const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();

  if (!cleanText) {
    await sendSlackMessage(
      client,
      channel,
      "I'm here! What can I help you with?",
      thread_ts
    );
    return;
  }

  await processMessage(workspace, dbUser, channel, thread_ts, cleanText, ts);
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

  const isNewConversation = !conversation;

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

    // Convert markdown to Slack format and send response
    let slackResponse = markdownToSlack(response);

    // Add web app link for new conversations
    if (isNewConversation) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
      const webChatUrl = `${appUrl}/chat/${conversation.id}`;
      slackResponse = `_You can always come back to this discussion in the Mikey web app: ${webChatUrl}_\n\n${slackResponse}`;
    }

    const responseTs = await sendSlackMessage(client, channel, slackResponse, threadTs);

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
 * Check if user can send a message (license/trial check)
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
): Promise<{ allowed: boolean; message: string; welcomeMessage?: string }> {
  const now = new Date();
  const TRIAL_DAYS = 7;

  // If user is actively licensed, allow
  if (user.licenseStatus === "ACTIVE") {
    return { allowed: true, message: "" };
  }

  // Check trial status
  if (user.licenseStatus === "TRIAL") {
    const trialStart = user.trialStartedAt || now;
    const daysSinceStart = Math.floor(
      (now.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Check if trial has expired (7 days)
    if (daysSinceStart >= TRIAL_DAYS) {
      await prisma.user.update({
        where: { id: user.id },
        data: { licenseStatus: "EXPIRED" },
      });

      return {
        allowed: false,
        message:
          "Your trial is all done! If you liked Mikey, go ahead and subscribe!",
      };
    }

    // Check if this is their first message (within first minute of trial)
    const secondsSinceStart = (now.getTime() - trialStart.getTime()) / 1000;
    if (secondsSinceStart < 60) {
      return {
        allowed: true,
        message: "",
        welcomeMessage:
          "Thanks for sending Mikey your first message! You've just started your trial - " +
          "you have 7 days to ask Mikey as much as you'd like! Have fun!",
      };
    }

    return { allowed: true, message: "" };
  }

  // User is expired or other status
  return {
    allowed: false,
    message:
      "Your trial is all done! If you liked Mikey, go ahead and subscribe!",
  };
}
