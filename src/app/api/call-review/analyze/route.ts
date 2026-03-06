import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { analyzeCallTranscript } from "@/lib/call-review/analyze";
import { calculateOverallScore, DISCOVERY_CALL_RUBRIC } from "@/lib/call-review/rubric";

// Allow up to 120s for GPT 5.2 analysis
export const maxDuration = 120;

// POST - Analyze a call transcript
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { transcript, includeDiscoveryQuestions, includeSalesNarrative, sourceUrl, sourceVendor } = await request.json();

    if (!transcript || transcript.trim().length < 100) {
      return NextResponse.json(
        { error: "Please provide a call transcript (at least 100 characters)." },
        { status: 400 },
      );
    }

    // Optionally fetch user's discovery questions for context
    let discoveryQuestions: string | null = null;
    let discoveryQuestionsVersionId: string | null = null;
    if (includeDiscoveryQuestions) {
      const dqVersion = await prisma.discoveryQuestionsVersion.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      if (dqVersion) {
        discoveryQuestions = dqVersion.content;
        discoveryQuestionsVersionId = dqVersion.id;
      }
    }

    // Optionally fetch sales narrative for context
    let salesNarrative: string | null = null;
    let salesNarrativeVersionId: string | null = null;
    if (includeSalesNarrative) {
      const snVersion = await prisma.salesNarrativeVersion.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      if (snVersion) {
        salesNarrative = snVersion.narrative;
        salesNarrativeVersionId = snVersion.id;
      }
    }

    // Run analysis
    const analysis = await analyzeCallTranscript(
      transcript,
      discoveryQuestions,
      salesNarrative,
    );

    // Calculate overall score
    const { overall, max } = calculateOverallScore(analysis);

    // Generate a rich title: "Rep Name - Prospect Company - Discovery Call"
    const repName = analysis.repName && analysis.repName !== "Unknown" ? analysis.repName : null;
    const prospectCompany = analysis.prospectCompany && analysis.prospectCompany !== "Unknown" ? analysis.prospectCompany : null;
    const titleParts: string[] = [];
    if (repName) titleParts.push(repName);
    if (prospectCompany) titleParts.push(prospectCompany);
    titleParts.push("Discovery Call");
    const title = titleParts.join(" - ");

    // Save to DB
    const version = await prisma.callReviewVersion.create({
      data: {
        userId: user.id,
        callType: "discovery",
        title,
        transcript,
        scores: JSON.stringify(analysis),
        overallScore: overall,
        maxScore: max,
        discoveryQuestionsVersionId,
        salesNarrativeVersionId,
        sourceUrl: sourceUrl || null,
        sourceVendor: sourceVendor || null,
      },
    });

    // Create a linked chat conversation
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
    const reportUrl = `${appUrl}/call-review?version=${version.id}`;

    const userMessage = `Review my discovery call transcript (${transcript.length.toLocaleString()} characters)`;
    const assistantContent = `[View full Call Review Scorecard](${reportUrl})\n\n**Score: ${overall}/${max}**\n\n${analysis.summary}\n\n**Top Strength:** ${analysis.topStrength}\n\n**Top Improvement:** ${analysis.topImprovement}`;

    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        source: "WEB",
        title: `Call Review: ${[repName, prospectCompany].filter(Boolean).join(" / ") || `${overall}/${max}`}`,
        firstMessagePreview: userMessage.substring(0, 100),
        messageCount: 2,
        lastMessageAt: new Date(),
        messages: {
          create: [
            { userId: user.id, role: "USER", content: userMessage },
            { role: "ASSISTANT", content: assistantContent },
          ],
        },
      },
    });

    // Update version with conversation ID
    await prisma.callReviewVersion.update({
      where: { id: version.id },
      data: { conversationId: conversation.id },
    });

    return NextResponse.json({
      success: true,
      version: {
        id: version.id,
        callType: "discovery",
        title,
        transcript,
        scores: analysis,
        overallScore: overall,
        maxScore: max,
        conversationId: conversation.id,
        createdAt: version.createdAt,
      },
    });
  } catch (error) {
    console.error("Error analyzing call:", error);
    return NextResponse.json(
      { error: "Failed to analyze call transcript. Please try again." },
      { status: 500 },
    );
  }
}
