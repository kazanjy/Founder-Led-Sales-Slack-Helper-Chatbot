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

    // Truncate if too long for social previews
    const description = firstUserMessage.length > 200
      ? firstUserMessage.substring(0, 197) + "..."
      : firstUserMessage;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";

    return {
      title: "Mikey - The Founder Led Sales Helper",
      description,
      openGraph: {
        title: "Mikey - The Founder Led Sales Helper",
        description,
        type: "website",
        url: `${appUrl}/share/${code}`,
        images: [
          {
            url: `${appUrl}/mikey-avatar.png`,
            width: 512,
            height: 512,
            alt: "Mikey - The Founder Led Sales Helper",
          },
        ],
        siteName: "Mikey",
      },
      twitter: {
        card: "summary",
        title: "Mikey - The Founder Led Sales Helper",
        description,
        images: [`${appUrl}/mikey-avatar.png`],
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
