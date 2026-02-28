import { prisma } from "@/lib/db";
import { getSlackClient, sendSlackMessage, getThreadMessages } from "./client";
import { sendToChatbase } from "@/lib/chatbase/client";
import { markdownToSlack } from "./markdown";
import { openai } from "@/lib/openai";
import { uploadFile, StoredFileReference } from "@/lib/supabase";
import { extractTextFromPDF, isPDFMimeType, formatPDFForAI } from "@/lib/pdf-server";

// Slack file object structure (subset of fields we need)
interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  filetype: string;
  url_private: string; // Requires bot token to download
  url_private_download?: string;
  size: number;
}

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
    files?: SlackFile[]; // File attachments
  };
}

// Supported image mime types
const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

// Supported PDF mime type
const PDF_MIME_TYPE = "application/pdf";

/**
 * Download a file from Slack using the bot token
 */
async function downloadSlackFile(
  fileUrl: string,
  botToken: string
): Promise<Buffer> {
  const response = await fetch(fileUrl, {
    headers: {
      Authorization: `Bearer ${botToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download Slack file: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Process an image through OpenAI Vision and get a description
 */
async function processImageThroughVision(
  base64DataUrl: string,
  fileName: string
): Promise<string> {
  console.log(`[Slack Vision] Processing image: ${fileName}`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `Analyze this image from a sales and business perspective. Extract:
- Any visible text, numbers, or data
- Pricing information, tiers, or plans if present
- Product features or capabilities mentioned
- Company or competitor information
- Organizational details (org charts, team structures)
- Meeting notes, action items, or follow-ups
- Any sales-relevant insights (objections, requirements, timelines)

Focus on information that would help a sales professional understand and use this content.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Please analyze this image and extract the relevant information.",
          },
          {
            type: "image_url",
            image_url: {
              url: base64DataUrl,
              detail: "high",
            },
          },
        ],
      },
    ],
    max_tokens: 2000,
    temperature: 0.3,
  });

  const description = response.choices[0]?.message?.content?.trim() || "";
  console.log(`[Slack Vision] Extracted ${description.length} chars from ${fileName}`);
  return description;
}

/**
 * Fetch the user's Sales Narrative for context injection (if available)
 * Returns null if no narrative exists
 */
async function getSalesNarrativeForContext(userId: string): Promise<string | null> {
  const narrativeVar = await prisma.gtmVariable.findFirst({
    where: { userId, mergeField: "SALES_NARRATIVE" },
    select: { value: true },
  });

  if (!narrativeVar?.value) return null;

  return `--- SALES NARRATIVE (Context about the user's product/service) ---\n\n${narrativeVar.value}\n\n--- END SALES NARRATIVE ---`;
}

/**
 * Process Slack file attachments - download, analyze, and store
 * Supports both images (via Vision API) and PDFs (via text extraction)
 */
async function processSlackFiles(
  files: SlackFile[],
  botToken: string,
  userId: string,
  conversationId: string
): Promise<{ descriptions: string[]; storedFiles: StoredFileReference[]; imageCount: number; pdfCount: number }> {
  const descriptions: string[] = [];
  const storedFiles: StoredFileReference[] = [];

  // Log all incoming files for debugging
  console.log("[Slack Files] Incoming files:", files.map(f => ({
    name: f.name,
    mimetype: f.mimetype,
    filetype: f.filetype,
    size: f.size,
  })));

  // Separate images and PDFs
  const imageFiles = files.filter((f) =>
    SUPPORTED_IMAGE_TYPES.includes(f.mimetype)
  );
  const pdfFiles = files.filter((f) =>
    isPDFMimeType(f.mimetype)
  );

  console.log("[Slack Files] Filtered:", {
    imageCount: imageFiles.length,
    pdfCount: pdfFiles.length,
    unsupportedFiles: files.filter(f =>
      !SUPPORTED_IMAGE_TYPES.includes(f.mimetype) && !isPDFMimeType(f.mimetype)
    ).map(f => ({ name: f.name, mimetype: f.mimetype })),
  });

  if (imageFiles.length === 0 && pdfFiles.length === 0) {
    return { descriptions, storedFiles, imageCount: 0, pdfCount: 0 };
  }

  console.log(`[Slack] Processing ${imageFiles.length} image(s) and ${pdfFiles.length} PDF(s)`);

  // Process images through Vision API
  for (const file of imageFiles) {
    try {
      // Download the file from Slack
      const fileBuffer = await downloadSlackFile(file.url_private, botToken);

      // Convert to base64 data URL
      const base64 = fileBuffer.toString("base64");
      const mimeType = file.mimetype;
      const dataUrl = `data:${mimeType};base64,${base64}`;

      // Process through vision API
      const description = await processImageThroughVision(dataUrl, file.name);
      descriptions.push(`[Image: ${file.name}]\n${description}`);

      // Upload to Supabase storage
      const storedRef = await uploadFile(userId, conversationId, {
        name: file.name,
        type: "image",
        data: dataUrl,
      });
      storedFiles.push(storedRef);

      console.log(`[Slack] Processed and stored image: ${file.name}`);
    } catch (error) {
      console.error(`[Slack] Error processing image ${file.name}:`, error);
      descriptions.push(`[Image: ${file.name}] (Error processing image)`);
    }
  }

  // Process PDFs through text extraction
  for (const file of pdfFiles) {
    try {
      // Download the PDF from Slack
      const fileBuffer = await downloadSlackFile(file.url_private, botToken);

      // Extract text from PDF
      const pdfResult = await extractTextFromPDF(fileBuffer, file.name);
      const formattedContent = formatPDFForAI(pdfResult);
      console.log(`[Slack PDF] Extracted ${pdfResult.fullText.length} chars from ${file.name} (${pdfResult.totalPages} pages), formatted to ${formattedContent.length} chars`);
      descriptions.push(formattedContent);

      // Store PDF in Supabase (as base64)
      const base64 = fileBuffer.toString("base64");
      const dataUrl = `data:application/pdf;base64,${base64}`;
      const storedRef = await uploadFile(userId, conversationId, {
        name: file.name,
        type: "pdf",
        data: dataUrl,
      });
      storedFiles.push(storedRef);

      console.log(`[Slack] Processed and stored PDF: ${file.name} (${pdfResult.totalPages} pages)`);
    } catch (error) {
      console.error(`[Slack] Error processing PDF ${file.name}:`, error);
      descriptions.push(`[PDF: ${file.name}] (Error processing PDF)`);
    }
  }

  return { descriptions, storedFiles, imageCount: imageFiles.length, pdfCount: pdfFiles.length };
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

  // Thread replies without @mention are intentionally ignored.
  // Mikey only responds when explicitly @mentioned.
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
  console.log("handleMention started:", {
    teamId,
    eventType: event.type,
    hasFiles: !!event.files,
    fileCount: event.files?.length || 0,
    files: event.files?.map(f => ({ name: f.name, mimetype: f.mimetype, filetype: f.filetype })),
  });

  const { user, text, channel, ts, thread_ts, files } = event;
  if (!user || !channel || !ts) {
    console.log("Missing required fields:", { user, channel, ts });
    return;
  }

  // Allow messages with just files (no text) if files are attached
  if (!text && (!files || files.length === 0)) {
    console.log("No text or files in message");
    return;
  }

  // If this @mention is in a thread, use thread_ts to continue that conversation
  // Otherwise use ts (this message becomes the thread parent)
  const threadTs = thread_ts || ts;

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

  const client = getSlackClient(workspace.botToken);

  // Get or create user
  const dbUser = await getOrCreateUser(workspace.id, user, workspace.botToken);
  console.log("User:", dbUser.id);

  // Check if user can send messages (license/trial check)
  const canSend = await checkUserCanSendMessage(dbUser);
  console.log("canSend:", canSend);

  if (!canSend.allowed) {
    await sendSlackMessage(client, channel, canSend.message, threadTs);
    return;
  }

  // Send welcome message for first-time users
  if (canSend.welcomeMessage) {
    await sendSlackMessage(client, channel, canSend.welcomeMessage, threadTs);
  }

  // Strip the bot mention from the message
  const cleanText = (text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
  console.log("Clean text:", cleanText);

  // Check if there are image attachments
  const hasFiles = files && files.length > 0;

  if (!cleanText && !hasFiles) {
    await sendSlackMessage(
      client,
      channel,
      "Hey! Ask me anything about founder-led sales. Just @mention me with your question.",
      threadTs
    );
    return;
  }

  // Check if Mikey is being summoned into an existing thread
  // (thread_ts exists and differs from ts, meaning we're replying to an existing thread)
  let priorThreadContext: string | undefined;
  let priorThreadFiles: SlackFile[] = [];

  if (thread_ts && thread_ts !== ts) {
    console.log("Mikey summoned into existing thread, fetching prior messages");
    try {
      const threadMessages = await getThreadMessages(client, channel, thread_ts);

      // Filter out the current message and any bot messages, take up to 50 prior messages
      const priorMessages = threadMessages
        .filter(msg => msg.ts !== ts && !msg.bot_id && msg.text)
        .slice(0, 50); // First 50 messages (oldest first since that's how Slack returns them)

      if (priorMessages.length > 0) {
        // Format as context for Chatbase
        const formattedMessages = priorMessages
          .map(msg => `[User]: ${msg.text}`)
          .join("\n");

        priorThreadContext = `Here's the conversation that was happening in this thread before I was mentioned:\n\n${formattedMessages}\n\n---\n\nNow the user is asking:`;
        console.log(`Fetched ${priorMessages.length} prior messages for context`);

        // Collect image and PDF files from prior messages
        for (const msg of priorMessages) {
          if (msg.files && msg.files.length > 0) {
            // Filter to supported image types and PDFs, add to collection
            const supportedFiles = msg.files.filter(f =>
              SUPPORTED_IMAGE_TYPES.includes(f.mimetype) || isPDFMimeType(f.mimetype)
            );
            priorThreadFiles.push(...supportedFiles);
          }
        }

        if (priorThreadFiles.length > 0) {
          console.log(`Found ${priorThreadFiles.length} files (images/PDFs) in prior thread messages`);
        }
      }
    } catch (error) {
      console.error("Error fetching prior thread messages:", error);
      // Continue without context if fetch fails
    }
  }

  // Combine files from current message with files from prior thread messages
  const allFiles: SlackFile[] = [
    ...priorThreadFiles,
    ...(hasFiles ? files! : []),
  ];

  // Process the message (with optional file attachments)
  console.log("Calling processMessage", {
    hasCurrentFiles: !!hasFiles,
    currentFileCount: files?.length,
    priorThreadFileCount: priorThreadFiles.length,
    totalFiles: allFiles.length
  });
  await processMessage(
    workspace,
    dbUser,
    channel,
    threadTs,
    cleanText,
    ts,
    priorThreadContext,
    allFiles.length > 0 ? allFiles : undefined
  );
  console.log("processMessage completed");
}

/**
 * Handle direct message
 */
async function handleDirectMessage(
  teamId: string,
  event: SlackEventPayload["event"]
) {
  const { user, text, channel, ts, thread_ts, files } = event;

  // Allow messages with just files (no text)
  const hasFiles = files && files.length > 0;
  if (!user || !channel || !ts) return;
  if (!text && !hasFiles) return;

  // Get the workspace
  const workspace = await prisma.workspace.findUnique({
    where: { slackTeamId: teamId },
  });

  if (!workspace) {
    console.error("Workspace not found:", teamId);
    return;
  }

  const client = getSlackClient(workspace.botToken);

  // Get or create user
  const dbUser = await getOrCreateUser(workspace.id, user, workspace.botToken);

  // Check if user can send messages
  const canSend = await checkUserCanSendMessage(dbUser);
  const threadTs = thread_ts || ts;

  if (!canSend.allowed) {
    await sendSlackMessage(client, channel, canSend.message, threadTs);
    return;
  }

  // Send welcome message for first-time users
  if (canSend.welcomeMessage) {
    await sendSlackMessage(client, channel, canSend.welcomeMessage, threadTs);
  }

  await processMessage(
    workspace,
    dbUser,
    channel,
    threadTs,
    text || "",
    ts,
    undefined, // no prior thread context for DMs
    hasFiles ? files : undefined
  );
}

/**
 * Process a message and generate a response
 * @param priorThreadContext - Optional context from prior thread messages (when Mikey is summoned mid-thread)
 * @param files - Optional Slack file attachments
 */
async function processMessage(
  workspace: { id: string; botToken: string; botUserId: string | null },
  user: { id: string; slackUserId: string | null },
  channel: string,
  threadTs: string,
  text: string,
  messageTs?: string,
  priorThreadContext?: string,
  files?: SlackFile[]
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

  // Process file attachments if present
  let finalText = text;
  let storedFiles: StoredFileReference[] = [];

  if (files && files.length > 0) {
    console.log(`[Slack] Processing ${files.length} file attachments`);

    // Count images and PDFs for the processing message
    const imageCount = files.filter(f => SUPPORTED_IMAGE_TYPES.includes(f.mimetype)).length;
    const pdfCount = files.filter(f => isPDFMimeType(f.mimetype)).length;

    // Build processing message
    const processingParts: string[] = [];
    if (imageCount > 0) {
      processingParts.push(`${imageCount} image${imageCount > 1 ? "s" : ""}`);
    }
    if (pdfCount > 0) {
      processingParts.push(`${pdfCount} PDF${pdfCount > 1 ? "s" : ""}`);
    }

    if (processingParts.length > 0) {
      // Send a "processing" message to acknowledge the files
      await sendSlackMessage(
        client,
        channel,
        `📎 Processing ${processingParts.join(" and ")}...`,
        threadTs
      );
    }

    const { descriptions, storedFiles: stored } = await processSlackFiles(
      files,
      workspace.botToken,
      user.id,
      conversation.id
    );

    storedFiles = stored;

    // Append file descriptions to the message
    if (descriptions.length > 0) {
      const fileSection = descriptions.join("\n\n");
      finalText = text
        ? `${text}\n\n---\n\n${fileSection}`
        : fileSection;
    }

    // Update conversation with stored file references
    if (storedFiles.length > 0) {
      // Get existing images and append new ones
      const existingImages = (conversation.imagesIncluded as StoredFileReference[] | null) || [];
      const allImages = [...existingImages, ...storedFiles];

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          imagesIncluded: JSON.parse(JSON.stringify(allImages)),
        },
      });
    }
  }

  // Check for #noattachments command to opt-out of automatic Sales Narrative context
  const noAttachmentsCommand = /#noattachments\b/i.test(finalText);
  console.log(`[Slack] Checking for #noattachments in: "${finalText.substring(0, 100)}..." - found: ${noAttachmentsCommand}`);
  if (noAttachmentsCommand) {
    // Remove the command from the message
    finalText = finalText.replace(/#noattachments\b/gi, "").trim();
  }

  // If we have prior thread context (Mikey was summoned mid-thread), prepend it to the message
  let messageWithContext = priorThreadContext
    ? `${priorThreadContext}\n\n${finalText}`
    : finalText;

  // For new conversations, check if user has a Sales Narrative and append it as context
  // (similar to how attachments work in web-based chats)
  // Skip if user used #noattachments command
  let salesNarrativeIncluded = false;
  let salesNarrativeOptedOut = false;
  if (isNewConversation) {
    if (noAttachmentsCommand) {
      salesNarrativeOptedOut = true;
      console.log(`[Slack] User opted out of Sales Narrative context with #noattachments`);
    } else {
      const salesNarrative = await getSalesNarrativeForContext(user.id);
      if (salesNarrative) {
        messageWithContext = `${messageWithContext}\n\n${salesNarrative}`;
        salesNarrativeIncluded = true;
        console.log(`[Slack] Appended Sales Narrative context for user ${user.id}`);
      }
    }
  }

  // Save user message (with Sales Narrative context if included, so it's visible in web app)
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      userId: user.id,
      role: "USER",
      content: messageWithContext,
      slackMessageTs: messageTs,
    },
  });

  // Update conversation to track that Sales Narrative was included
  if (salesNarrativeIncluded) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        attachmentsIncluded: ["salesNarrative"],
      },
    });
  }

  // Build conversation history only if we don't have a Chatbase conversation ID yet
  // When we have a conversationId, Chatbase persists context on their end
  let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  if (!conversation.chatbaseConversationId) {
    // First message in this conversation - need to send any existing history
    const history = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      take: 20, // Last 20 messages for context
    });

    chatbaseHistory = history.slice(0, -1).map((msg: { role: string; content: string }) => ({
      role: msg.role.toLowerCase() as "user" | "assistant",
      content: msg.content,
    }));
  }

  try {
    // Log message size before sending to Chatbase
    console.log(`[Slack -> Chatbase] Message size: ${messageWithContext.length} chars, history: ${chatbaseHistory.length} messages`);
    if (messageWithContext.length > 7500) {
      console.warn(`[Slack -> Chatbase] WARNING: Message exceeds 7500 char limit, will be truncated by ${messageWithContext.length - 7500} chars`);
    }

    // Get response from Chatbase
    // If we have a conversationId, Chatbase already has the context - just send the new message
    const { response, conversationId: chatbaseConvId } = await sendToChatbase(
      messageWithContext,
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

    // Add Sales Narrative context notice if it was included or opted out
    if (salesNarrativeIncluded) {
      slackResponse = `_📋 Your Sales Narrative was provided to Mikey for context._\n\n${slackResponse}`;
    } else if (salesNarrativeOptedOut) {
      slackResponse = `_Per #noattachments command, your Sales Narrative was not provided to Mikey as context._\n\n${slackResponse}`;
    }

    // Add web app link and thread reply instructions for new conversations
    if (isNewConversation) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
      const webChatUrl = `${appUrl}/chat/${conversation.id}`;
      slackResponse = `_You can always come back to this discussion in the Mikey web app:_ ${webChatUrl}\n_To continue chatting in this thread, just @mention me again._\n\n${slackResponse}`;
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
async function getOrCreateUser(workspaceId: string, slackUserId: string, botToken: string) {
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

    // Fetch user info from Slack
    let slackUserName: string | null = null;
    let slackEmail: string | null = null;

    try {
      const client = getSlackClient(botToken);
      const userInfoResponse = await client.users.info({ user: slackUserId });

      if (userInfoResponse.ok && userInfoResponse.user) {
        const slackUser = userInfoResponse.user;
        // Use real_name (full name) or fallback to display name
        slackUserName = slackUser.real_name || slackUser.profile?.display_name || slackUser.name || null;
        slackEmail = slackUser.profile?.email || null;
      }
    } catch (error) {
      console.error("Failed to fetch Slack user info:", error);
      // Continue without user info - we can still create the user
    }

    user = await prisma.user.create({
      data: {
        slackUserId,
        workspaceId,
        slackUserName,
        slackEmail,
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
    workspaceId: string | null;
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

      const upgradeUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai"}/upgrade`;
      return {
        allowed: false,
        message:
          `Your trial is all done! If you liked Mikey, go ahead and subscribe: ${upgradeUrl}`,
      };
    }

    // Check if this is their first message (within first minute of trial)
    // Must be >= 0 to avoid false triggers when trialStartedAt is in the future (extended trials)
    const secondsSinceStart = (now.getTime() - trialStart.getTime()) / 1000;
    if (secondsSinceStart >= 0 && secondsSinceStart < 60) {
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
  const upgradeUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai"}/upgrade`;
  return {
    allowed: false,
    message:
      `Your trial is all done! If you liked Mikey, go ahead and subscribe: ${upgradeUrl}`,
  };
}
