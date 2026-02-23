import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export interface AttachmentInfo {
  id: string;
  name: string;
  description: string;
  appUrl: string;
  isAvailable: boolean;
  lastUpdated: string | null;
}

// GET - List all available attachments with completion status
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Check availability of each attachment type
    const [
      salesNarrativeVar,
      gtmAssessment,
      discoveryQuestionsVar,
      firstCallChecklistVar,
    ] = await Promise.all([
      // Sales Narrative - check GtmVariable
      prisma.gtmVariable.findFirst({
        where: { userId: user.id, mergeField: "SALES_NARRATIVE" },
        select: { updatedAt: true, value: true },
      }),
      // GTM Assessment - check for completed assessment
      prisma.maturityAssessment.findFirst({
        where: { userId: user.id },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true },
      }),
      // Discovery Questions - check GtmVariable
      prisma.gtmVariable.findFirst({
        where: { userId: user.id, mergeField: "DISCOVERY_QUESTIONS" },
        select: { updatedAt: true, value: true },
      }),
      // First Call Checklist - check GtmVariable
      prisma.gtmVariable.findFirst({
        where: { userId: user.id, mergeField: "FIRST_CALL_CHECKLIST" },
        select: { updatedAt: true, value: true },
      }),
    ]);

    const attachments: AttachmentInfo[] = [
      {
        id: "salesNarrative",
        name: "Sales Narrative",
        description: "Your sales narrative and value propositions",
        appUrl: "/sales-narrative",
        isAvailable: !!(salesNarrativeVar?.value),
        lastUpdated: salesNarrativeVar?.updatedAt?.toISOString() || null,
      },
      {
        id: "gtmAssessment",
        name: "GTM Assessment",
        description: "Your GTM maturity assessment Q&A",
        appUrl: "/assessment/bulk",
        isAvailable: !!gtmAssessment,
        lastUpdated: gtmAssessment?.completedAt?.toISOString() || null,
      },
      {
        id: "discoveryQuestions",
        name: "Discovery Questions",
        description: "Your tailored discovery questions",
        appUrl: "/discovery-questions",
        isAvailable: !!(discoveryQuestionsVar?.value),
        lastUpdated: discoveryQuestionsVar?.updatedAt?.toISOString() || null,
      },
      {
        id: "firstCallChecklist",
        name: "First Call Checklist",
        description: "Your first call preparation checklist",
        appUrl: "/first-call-checklist",
        isAvailable: !!(firstCallChecklistVar?.value),
        lastUpdated: firstCallChecklistVar?.updatedAt?.toISOString() || null,
      },
    ];

    return NextResponse.json({ attachments });
  } catch (error) {
    console.error("Error fetching available attachments:", error);
    return NextResponse.json(
      { error: "Failed to fetch available attachments" },
      { status: 500 }
    );
  }
}
