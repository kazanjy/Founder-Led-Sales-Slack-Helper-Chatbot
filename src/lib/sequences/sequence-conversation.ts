import { prisma } from "@/lib/db";

interface CreateSequenceConversationParams {
  userId: string;
  sequenceType: "email" | "linkedin" | "cold-call";
  orgPersona: string;
  humanPersona: string;
  specialNotes?: string | null;
  content: string;
  reportUrl: string;
}

/**
 * Create a chat conversation from a generated sequence so the user
 * can continue discussing it in the main chat UI.
 */
export async function createSequenceConversation(params: CreateSequenceConversationParams) {
  const {
    userId,
    sequenceType,
    orgPersona,
    humanPersona,
    specialNotes,
    content,
    reportUrl,
  } = params;

  const typeLabel = sequenceType === "email" ? "Email Sequence" : sequenceType === "linkedin" ? "LinkedIn Sequence" : "Cold Call Script";

  // Build the structured user message
  const inputLines = [`Generate a ${typeLabel.toLowerCase()} for:`];
  inputLines.push(`- Organization: ${orgPersona}`);
  inputLines.push(`- Target Role: ${humanPersona}`);
  if (specialNotes) inputLines.push(`- Special Notes: ${specialNotes}`);
  const userMessage = inputLines.join("\n");

  // Build the assistant message with report link at top
  const assistantMessage = `[View full ${typeLabel}](${reportUrl})\n\n${content}`;

  // Title
  const title = `${typeLabel}: ${orgPersona} — ${humanPersona}`;

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
