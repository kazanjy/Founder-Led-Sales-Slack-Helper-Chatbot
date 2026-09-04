import { prisma } from "@/lib/db";

interface CreateResearchConversationParams {
  userId: string;
  researchId: string;
  companyName: string;
  contactName?: string | null;
  contactTitle?: string | null;
  contactLinkedIn?: string | null;
  companyDomain?: string | null;
  urls?: string[];
  briefContent: string;
  reportUrl: string;
}

/**
 * Create a chat conversation from a pre-call research brief so the user
 * can continue discussing the prospect in the main chat UI.
 *
 * Creates a USER message (structured research request) and an ASSISTANT
 * message (the research brief with a link to the full report).
 */
export async function createResearchConversation(params: CreateResearchConversationParams) {
  const {
    userId,
    companyName,
    contactName,
    contactTitle,
    contactLinkedIn,
    companyDomain,
    urls,
    briefContent,
    reportUrl,
  } = params;

  // Build the structured user message
  const inputLines = [`Please do a pre-call research report on:`];
  inputLines.push(`- Company: ${companyName}`);
  if (companyDomain) inputLines.push(`- Domain: ${companyDomain}`);
  if (contactName) inputLines.push(`- Contact: ${contactName}`);
  if (contactTitle) inputLines.push(`- Title: ${contactTitle}`);
  if (contactLinkedIn) inputLines.push(`- LinkedIn: ${contactLinkedIn}`);
  if (urls && urls.length > 0) {
    for (const url of urls) {
      inputLines.push(`- URL: ${url}`);
    }
  }
  const userMessage = inputLines.join("\n");

  // Build the assistant message with report link at top
  const assistantMessage = `[View full Pre-Call Research Report](${reportUrl})\n\n${briefContent}`;

  // Build a title for the conversation
  const title = contactName
    ? `Pre-Call Research: ${companyName} — ${contactName}`
    : `Pre-Call Research: ${companyName}`;

  // Create conversation + both messages in a transaction
  const conversation = await prisma.conversation.create({
    data: {
      userId,
      source: "WEB",
      title,
      firstMessagePreview: userMessage.substring(0, 100),
      messageCount: 2,
      lastMessageAt: new Date(),
      messages: {
        create: [
          {
            userId,
            role: "USER",
            content: userMessage,
          },
          {
            role: "ASSISTANT",
            content: assistantMessage,
          },
        ],
      },
    },
  });

  return conversation;
}
