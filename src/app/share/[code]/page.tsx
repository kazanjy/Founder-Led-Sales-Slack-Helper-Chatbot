import { Metadata } from "next";
import { prisma } from "@/lib/db";
import SharePageClient from "./SharePageClient";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;

  try {
    const sharedConversation = await prisma.sharedConversation.findUnique({
      where: { shareCode: code },
      include: {
        conversation: {
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
              take: 2, // Get first user message and first assistant response
            },
          },
        },
      },
    });

    if (!sharedConversation) {
      return {
        title: "Shared chat from Mikey - The Founder-Led Sales Helper",
        description: "A shared conversation from Mikey",
      };
    }

    const firstUserMessage = sharedConversation.conversation.messages.find(m => m.role === "USER")?.content ||
      sharedConversation.conversation.firstMessagePreview ||
      "founder-led sales";

    const firstAssistantMessage = sharedConversation.conversation.messages.find(m => m.role === "ASSISTANT")?.content ||
      "A conversation about founder-led sales";

    // Build title with topic - OG title can be longer
    const topicForTitle = firstUserMessage.length > 80
      ? firstUserMessage.substring(0, 77) + "..."
      : firstUserMessage;
    const title = `Shared chat from Mikey - The Founder-Led Sales Helper | Topic: ${topicForTitle}`;

    // Description is the assistant's response content
    const description = firstAssistantMessage.length > 200
      ? firstAssistantMessage.substring(0, 197) + "..."
      : firstAssistantMessage;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";

    const imageUrl = `${appUrl}/opengraph-image`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        url: `${appUrl}/share/${code}`,
        siteName: "Mikey",
        images: [
          {
            url: imageUrl,
            secureUrl: imageUrl,
            width: 1200,
            height: 630,
            type: "image/png",
            alt: "Mikey - AI-Powered Founder-Led Sales Platform",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [imageUrl],
      },
    };
  } catch (error) {
    console.error("Error generating metadata:", error);
    return {
      title: "Shared chat from Mikey - The Founder-Led Sales Helper",
      description: "A shared conversation from Mikey",
    };
  }
}

export default async function SharedChatPage({ params }: PageProps) {
  const { code } = await params;
  return <SharePageClient code={code} />;
}
