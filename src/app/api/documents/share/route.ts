import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { randomBytes } from "crypto";

// POST - Create a public share link for a sales document
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { documentType, documentId, title, content } = await request.json();

    if (!documentType || !documentId || !title || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Whitelist of shareable document types. The seven appended below
    // (hiringProfile, salesLeaderProfile, preHireAssessment, icp,
    // callRecap, salesMetrics, salesMotion) were rendered via
    // ShareDocumentButton on their respective pages but were never
    // added here, so every "share link" click 400'd as "Invalid
    // document type". Keeping the whitelist (vs. removing it) so a
    // malformed payload from somewhere else doesn't accidentally
    // create public share rows.
    const validTypes = [
      "salesNarrative",
      "discoveryQuestions",
      "firstCallChecklist",
      "preCallPlanning",
      "preCallResearch",
      "emailSequence",
      "linkedInSequence",
      "callReview",
      "coldCallScript",
      "salesDeck",
      "adCreator",
      "objectionLibrary",
      "socialContent",
      "hiringProfile",
      "salesLeaderProfile",
      "preHireAssessment",
      "icp",
      "callRecap",
      "salesMetrics",
      "salesMotion",
    ];
    if (!validTypes.includes(documentType)) {
      return NextResponse.json({ error: "Invalid document type" }, { status: 400 });
    }

    // Check if already shared (reuse existing share link)
    let sharedDoc = await prisma.sharedDocument.findFirst({
      where: {
        documentType,
        documentId,
        createdByUserId: user.id,
      },
    });

    if (sharedDoc) {
      // Update the content snapshot
      sharedDoc = await prisma.sharedDocument.update({
        where: { id: sharedDoc.id },
        data: { title, content },
      });
    } else {
      const shareCode = randomBytes(8).toString("hex");
      sharedDoc = await prisma.sharedDocument.create({
        data: {
          documentType,
          documentId,
          createdByUserId: user.id,
          shareCode,
          title,
          content,
        },
      });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
    const shareUrl = `${appUrl}/share/doc/${sharedDoc.shareCode}`;

    return NextResponse.json({ shareUrl, shareCode: sharedDoc.shareCode });
  } catch (error) {
    console.error("Error sharing document:", error);
    return NextResponse.json({ error: "Failed to share document" }, { status: 500 });
  }
}
