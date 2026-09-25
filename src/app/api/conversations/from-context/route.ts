import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateChatTitle } from "@/lib/openai";

/**
 * POST /api/conversations/from-context
 * Creates a new conversation pre-seeded with context from an asset.
 * The user message contains the context, and no assistant reply is generated yet.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { title, context, autoSend, mode, titleSeed } = await request.json();

    if (!context || typeof context !== "string") {
      return NextResponse.json({ error: "Context is required" }, { status: 400 });
    }

    /**
     * Name the chat after the QUESTION when there is one.
     *
     * Without this, every chat started from the same asset got the same
     * title — two questions about one coaching session were
     * indistinguishable in the sidebar, which is the whole problem this
     * solves. The caller passes the founder's prompt as titleSeed and
     * the title comes from that.
     *
     * Seeded with the prompt ALONE, never the context: generateChatTitle
     * only reads the first 500 characters, so a short question followed
     * by a long transcript would produce a title about the transcript.
     *
     * Awaited rather than fired off, because unlike the agent route
     * there is no pollForTitle channel here to deliver a late rename —
     * the conversation is created and the tab opens on it immediately.
     * It is one small call; the fallback covers it failing.
     */
    let conversationTitle = title || "Chat About Asset";
    if (typeof titleSeed === "string" && titleSeed.trim()) {
      const seed = titleSeed.trim();
      const generated = await generateChatTitle(seed);
      conversationTitle =
        generated && generated !== "New Conversation"
          ? generated
          : seed.length > 60
            ? `${seed.slice(0, 57)}…`
            : seed;
    }
    // Validate mode — defaults to CHATBASE (schema default) so
    // existing callers don't change behavior. Callers that want
    // GPT's longer context window — e.g., the "What's Next" coaching
    // + readiness flow that bundles full transcripts — pass "DIRECT".
    const conversationMode: "CHATBASE" | "DIRECT" = mode === "DIRECT" ? "DIRECT" : "CHATBASE";

    // If autoSend, create empty conversation (message will be sent by chat page)
    // Otherwise, create with user message pre-seeded
    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        source: "WEB",
        mode: conversationMode,
        title: conversationTitle,
        // Set even when autoSend leaves the conversation empty, and
        // deliberately so: the agent route auto-titles only when this
        // is blank, and that would regenerate a title from the prompt
        // AND the whole context, overwriting the better one set above.
        firstMessagePreview: context.substring(0, 100),
        messageCount: autoSend ? 0 : 1,
        lastMessageAt: new Date(),
        ...(autoSend ? {} : {
          messages: {
            create: [
              {
                userId: user.id,
                role: "USER",
                content: context,
              },
            ],
          },
        }),
      },
    });

    return NextResponse.json({ conversationId: conversation.id, autoSendContext: autoSend ? context : undefined });
  } catch (error) {
    console.error("Error creating context conversation:", error);
    return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 });
  }
}
