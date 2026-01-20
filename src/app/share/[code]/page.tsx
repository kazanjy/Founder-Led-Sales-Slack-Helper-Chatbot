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
              where: { role: "USER" },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
          },
        },
      },
    });

    if (!sharedConversation) {
      return {
        title: "Mikey - The Founder Led Sales Helper",
        description: "A shared conversation from Mikey",
      };
    }

    const firstUserMessage = sharedConversation.conversation.messages[0]?.content ||
      sharedConversation.conversation.firstMessagePreview ||
      "A conversation about founder-led sales";

    // Truncate if too long for social previews and add "Topic:" prefix
    const topicText = firstUserMessage.length > 190
      ? firstUserMessage.substring(0, 187) + "..."
      : firstUserMessage;
    const description = `Topic: ${topicText}`;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";

    const imageUrl = `${appUrl}/mikey-avatar.png`;

    return {
      title: "Mikey - The Founder Led Sales Helper",
      description,
      openGraph: {
        title: "Mikey - The Founder Led Sales Helper",
        description,
        type: "website",
        url: `${appUrl}/share/${code}`,
        siteName: "Mikey",
        images: [
          {
            url: imageUrl,
            secureUrl: imageUrl,
            width: 512,
            height: 512,
            type: "image/png",
            alt: "Mikey - The Founder Led Sales Helper",
          },
        ],
      },
      twitter: {
        card: "summary",
        title: "Mikey - The Founder Led Sales Helper",
        description,
        images: [imageUrl],
      },
      other: {
        "og:image:url": imageUrl,
        "og:image:secure_url": imageUrl,
      },
    };
  } catch (error) {
    console.error("Error generating metadata:", error);
    return {
      title: "Mikey - The Founder Led Sales Helper",
      description: "A shared conversation from Mikey",
    };
  }
}

export default async function SharedChatPage({ params }: PageProps) {
  const { code } = await params;
  return <SharePageClient code={code} />;
}
