import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q")?.trim() || "";
  const limit = parseInt(searchParams.get("limit") || "10", 10);

  try {
    // If no query, return most recent conversations
    if (!query) {
      const conversations = await prisma.conversation.findMany({
        where: {
          userId: user.id,
          archived: false,
        },
        orderBy: { lastMessageAt: "desc" },
        take: limit,
        select: {
          id: true,
          title: true,
          source: true,
          lastMessageAt: true,
          messages: {
            take: 1,
            orderBy: { createdAt: "asc" },
            select: {
              content: true,
            },
          },
        },
      });

      return NextResponse.json({
        results: conversations.map((c) => ({
          id: c.id,
          title: c.title,
          source: c.source,
          lastMessageAt: c.lastMessageAt,
          preview: c.messages[0]?.content?.substring(0, 200) || null,
          matchSnippet: null,
        })),
      });
    }

    // Search through conversation titles and message content
    // First, search conversations by title
    const conversationsByTitle = await prisma.conversation.findMany({
      where: {
        userId: user.id,
        archived: false,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { lastMessageAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        source: true,
        lastMessageAt: true,
        messages: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: {
            content: true,
          },
        },
      },
    });

    // Search through messages
    const messagesWithMatch = await prisma.message.findMany({
      where: {
        conversation: {
          userId: user.id,
          archived: false,
        },
        content: { contains: query, mode: "insensitive" },
      },
      orderBy: { createdAt: "desc" },
      take: limit * 2, // Get more to dedupe by conversation
      select: {
        content: true,
        conversation: {
          select: {
            id: true,
            title: true,
            source: true,
            lastMessageAt: true,
            messages: {
              take: 1,
              orderBy: { createdAt: "asc" },
              select: {
                content: true,
              },
            },
          },
        },
      },
    });

    // Combine and dedupe results
    const seenIds = new Set<string>();
    const results: Array<{
      id: string;
      title: string | null;
      source: string;
      lastMessageAt: Date;
      preview: string | null;
      matchSnippet: string | null;
    }> = [];

    // Add title matches first
    for (const c of conversationsByTitle) {
      if (!seenIds.has(c.id)) {
        seenIds.add(c.id);
        results.push({
          id: c.id,
          title: c.title,
          source: c.source,
          lastMessageAt: c.lastMessageAt,
          preview: c.messages[0]?.content?.substring(0, 200) || null,
          matchSnippet: null,
        });
      }
    }

    // Add message content matches
    for (const m of messagesWithMatch) {
      const c = m.conversation;
      if (!seenIds.has(c.id) && results.length < limit) {
        seenIds.add(c.id);

        // Extract snippet around the match
        const lowerContent = m.content.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const matchIndex = lowerContent.indexOf(lowerQuery);

        let snippet: string | null = null;
        if (matchIndex !== -1) {
          const start = Math.max(0, matchIndex - 50);
          const end = Math.min(m.content.length, matchIndex + query.length + 100);
          snippet = (start > 0 ? "..." : "") +
                   m.content.substring(start, end) +
                   (end < m.content.length ? "..." : "");
        }

        results.push({
          id: c.id,
          title: c.title,
          source: c.source,
          lastMessageAt: c.lastMessageAt,
          preview: c.messages[0]?.content?.substring(0, 200) || null,
          matchSnippet: snippet,
        });
      }
    }

    // Sort by lastMessageAt
    results.sort((a, b) =>
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );

    return NextResponse.json({ results: results.slice(0, limit) });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Failed to search conversations" },
      { status: 500 }
    );
  }
}
