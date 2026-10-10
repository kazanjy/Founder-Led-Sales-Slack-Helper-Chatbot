import { Metadata } from "next";
import { prisma } from "@/lib/db";
import SharedDocClient from "./SharedDocClient";

interface PageProps {
  params: Promise<{ code: string }>;
}

const typeLabels: Record<string, string> = {
  salesNarrative: "Sales Narrative",
  discoveryQuestions: "Discovery Questions",
  firstCallChecklist: "First Call Checklist",
  preCallPlanning: "Pre-Call Checklist",
  preCallResearch: "Pre-Call Research",
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;

  try {
    const sharedDoc = await prisma.sharedDocument.findUnique({
      where: { shareCode: code },
    });

    if (!sharedDoc) {
      return {
        title: "Shared document from Mikey - The Founder-Led Sales Helper",
        description: "A shared sales document from Mikey",
      };
    }

    const typeLabel = typeLabels[sharedDoc.documentType] || sharedDoc.documentType;
    const title = `${sharedDoc.title} - Shared from Mikey`;

    const description = sharedDoc.content.length > 200
      ? sharedDoc.content.substring(0, 197) + "..."
      : sharedDoc.content;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        url: `${appUrl}/share/doc/${code}`,
        siteName: "Mikey",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
      },
    };
  } catch (error) {
    console.error("Error generating metadata:", error);
    return {
      title: "Shared document from Mikey - The Founder-Led Sales Helper",
      description: "A shared sales document from Mikey",
    };
  }
}

export default async function SharedDocPage({ params }: PageProps) {
  const { code } = await params;
  return <SharedDocClient code={code} />;
}
