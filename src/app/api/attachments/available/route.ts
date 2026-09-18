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
      icpVar,
      discoveryQuestionsVar,
      firstCallChecklistVar,
      preCallPlanningVar,
      salesDeckVar,
      coachingSessionCount,
      salesAssetCount,
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
      // ICP - check GtmVariable
      prisma.gtmVariable.findFirst({
        where: { userId: user.id, mergeField: "ICP" },
        select: { updatedAt: true, value: true },
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
      // Pre-Call Planning Process - check GtmVariable
      prisma.gtmVariable.findFirst({
        where: { userId: user.id, mergeField: "PRE_CALL_PLANNING" },
        select: { updatedAt: true, value: true },
      }),
      // Sales Deck - check GtmVariable
      prisma.gtmVariable.findFirst({
        where: { userId: user.id, mergeField: "SALES_DECK" },
        select: { updatedAt: true, value: true },
      }),
      // Coaching History - check for any sessions
      prisma.coachingSession.count({
        where: { userId: user.id },
      }),
      // Sales Asset Library - check for any saved assets (account-scoped)
      user.accountId
        ? prisma.salesAsset.count({ where: { accountId: user.accountId } })
        : Promise.resolve(0),
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
        id: "icp",
        name: "Ideal Customer Profile",
        description: "Your ideal customer characteristics, personas, and qualification criteria",
        appUrl: "/icp",
        isAvailable: !!(icpVar?.value),
        lastUpdated: icpVar?.updatedAt?.toISOString() || null,
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
      {
        id: "preCallPlanning",
        name: "Pre-Call Planning Process",
        description: "Your pre-call research and preparation process",
        appUrl: "/pre-call-planning",
        isAvailable: !!(preCallPlanningVar?.value),
        lastUpdated: preCallPlanningVar?.updatedAt?.toISOString() || null,
      },
      {
        id: "salesDeck",
        name: "Sales Deck",
        description: "Your sales deck outline and speaker scripts",
        appUrl: "/sales-deck",
        isAvailable: !!(salesDeckVar?.value),
        lastUpdated: salesDeckVar?.updatedAt?.toISOString() || null,
      },
      {
        id: "coachingHistory",
        name: "Coaching History",
        description: "All coaching session notes and transcripts",
        appUrl: "/coaching-history",
        isAvailable: coachingSessionCount > 0,
        lastUpdated: null,
      },
      {
        id: "salesAssetLibrary",
        name: "Sales Asset Library",
        description: "Your saved sales collateral — one-pagers, case studies, battle cards, etc.",
        appUrl: "/sales-asset-library",
        isAvailable: salesAssetCount > 0,
        lastUpdated: null,
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
