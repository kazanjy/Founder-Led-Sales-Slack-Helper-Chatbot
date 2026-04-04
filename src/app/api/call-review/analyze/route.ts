import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { analyzeCallTranscript } from "@/lib/call-review/analyze";
import { calculateOverallScore } from "@/lib/call-review/rubric";

// Allow up to 120s for GPT 5.2 analysis
export const maxDuration = 120;

// POST - Analyze a call transcript (SSE streaming)
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    const { transcript, includeDiscoveryQuestions, includeSalesNarrative, sourceUrl, sourceVendor } = await request.json();

    if (!transcript || transcript.trim().length < 100) {
      return new Response(
        JSON.stringify({ error: "Please provide a call transcript (at least 100 characters)." }),
        { status: 400 },
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
          send("progress", { stage: "context", message: "Gathering context...", progress: 10 });

          // Fetch discovery questions if requested
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

          // Fetch sales narrative if requested
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

          send("progress", { stage: "analyzing", message: "Analyzing call transcript with AI...", progress: 25 });

          // Run analysis
          const analysis = await analyzeCallTranscript(
            transcript,
            discoveryQuestions,
            salesNarrative,
          );

          send("progress", { stage: "scoring", message: "Calculating scores...", progress: 75 });

          // Calculate overall score
          const { overall, max } = calculateOverallScore(analysis);

          // Generate title
          const repName = analysis.repName && analysis.repName !== "Unknown" ? analysis.repName : null;
          const prospectCompany = analysis.prospectCompany && analysis.prospectCompany !== "Unknown" ? analysis.prospectCompany : null;
          const titleParts: string[] = [];
          if (repName) titleParts.push(repName);
          if (prospectCompany) titleParts.push(prospectCompany);
          titleParts.push("Discovery Call");
          const title = titleParts.join(" - ");

          send("progress", { stage: "saving", message: "Saving results...", progress: 85 });

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

          send("progress", { stage: "chat", message: "Creating conversation thread...", progress: 95 });

          // Create linked conversation
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

          send("complete", {
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
          send("error", { message: error instanceof Error ? error.message : "Failed to analyze call transcript." });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (error) {
    console.error("Error in analyze route:", error);
    return new Response(JSON.stringify({ error: "Failed to analyze call transcript." }), { status: 500 });
  }
}
