import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

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

    const { title, context, autoSend } = await request.json();

    if (!context || typeof context !== "string") {
      return NextResponse.json({ error: "Context is required" }, { status: 400 });
    }

    const conversationTitle = title || "Chat About Asset";

    // If autoSend, create empty conversation (message will be sent by chat page)
    // Otherwise, create with user message pre-seeded
    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        source: "WEB",
        title: conversationTitle,
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
