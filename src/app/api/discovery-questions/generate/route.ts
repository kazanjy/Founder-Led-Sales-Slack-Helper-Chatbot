import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { extractProductName } from "@/lib/extract-product-name";
import { CHATBASE_MESSAGE_LIMIT, splitIntoChunks, buildChunkedHistory } from "@/lib/chatbase/chunking";

// Allow up to 120s for Chatbase AI generation
export const maxDuration = 120;

// POST - Generate discovery questions from the latest sales narrative
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get the latest sales narrative version with its answers
    const latestNarrative = await prisma.salesNarrativeVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        answers: {
          include: {
            question: {
              select: {
                id: true,
                category: true,
                globalOrder: true,
                question: true,
              },
            },
          },
          orderBy: {
            question: {
              globalOrder: "asc",
            },
          },
        },
      },
    });

    // Get the latest ICP if available
    const latestICP = await prisma.icpVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    let icpSection = "";
    if (latestICP) {
      try {
        const icpContent = JSON.parse(latestICP.content);
        // Format ICP into a readable section
        for (const segment of icpContent.segments || []) {
          icpSection += `### ${segment.name}\n`;
          icpSection += `${segment.description}\n`;
          icpSection += `Firmographic: ${segment.firmographic?.industry || ""} | ${segment.firmographic?.companySize || ""} | ${segment.firmographic?.revenue || ""}\n`;
          icpSection += `Timing Triggers: ${(segment.timingTriggers || []).join("; ")}\n`;
          icpSection += `Pain Points: ${(segment.painPoints || []).join("; ")}\n`;
          icpSection += `Buying Personas: ${(segment.buyingPersonas || []).map((p: { title: string; role: string }) => `${p.title} (${p.role})`).join(", ")}\n\n`;
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (!latestNarrative) {
      return NextResponse.json(
        { error: "No sales narrative found. Please create a sales narrative first." },
        { status: 400 }
      );
    }

    // Build the Q&A inputs section
    const categoryOrder = ["Product", "Problem", "Solution", "Proof", "Business"];
    let qaInputsSection = "";

    for (const category of categoryOrder) {
      const categoryAnswers = latestNarrative.answers.filter(
        (a) => a.question.category === category
      );
      if (categoryAnswers.length === 0) continue;

      qaInputsSection += `### ${category}\n\n`;
      for (const answer of categoryAnswers) {
        qaInputsSection += `**Q${answer.question.globalOrder}: ${answer.question.question}**\n`;
        qaInputsSection += `${answer.answer || "_Not answered_"}\n\n`;
      }
    }

    // Build instructions (fixed) and context (variable) separately
    const instructionPrompt = `You are an expert B2B sales coach helping founders create discovery questions for sales calls.

## OUTPUT FORMAT (CRITICAL — follow this exactly):

Respond with valid JSON in this exact format (no markdown code blocks, no extra text):
{
  "categories": [
    {
      "name": "Category Name",
      "description": "Brief description of this category's purpose",
      "questions": [
        {
          "primary": "The main question to ask",
          "followUps": ["Follow-up 1", "Follow-up 2"]
        }
      ]
    }
  ]
}

## INSTRUCTIONS:

Generate discovery questions organized into these 5 categories:
1. **Problem Discovery** - Uncover if the prospect has the problem, how severe it is, business impact.
2. **Current State** - How they handle the problem today, solutions tried, why those fail.
3. **Impact & Urgency** - Quantify costs (time, money, opportunity), timeline/urgency.
4. **Decision Process** - Who's involved, budget, evaluation criteria.
5. **Fit Qualification** - Is this prospect a good fit for the solution?

For each category: 4-6 open-ended questions with follow-up probes. Conversational, not interrogative. Tailored to the specific problem/solution provided in context.`;

    const contextSection = `## SALES NARRATIVE:\n\n${latestNarrative.narrative}${icpSection ? `\n\n## IDEAL CUSTOMER PROFILE:\n\n${icpSection}` : ""}`;
    const fullPrompt = `${instructionPrompt}\n\n${contextSection}`;

    let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let finalMessage = fullPrompt;

    if (fullPrompt.length > CHATBASE_MESSAGE_LIMIT) {
      const contextChunks = splitIntoChunks(contextSection, CHATBASE_MESSAGE_LIMIT);
      chatbaseHistory = buildChunkedHistory(contextChunks, "Sales Narrative");
      finalMessage = instructionPrompt;
      console.log(`[discovery-questions/generate] Chunked: ${contextChunks.length} chunks, final message: ${finalMessage.length} chars`);
    }

    console.log(`Sending discovery questions prompt: ${finalMessage.length} chars (history: ${chatbaseHistory.length} msgs)`);

    // Call Chatbase
    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate discovery questions. Please try again." },
        { status: 500 }
      );
    }

    // Parse the JSON response
    let parsedResponse: {
      categories: Array<{
        name: string;
        description: string;
        questions: Array<{
          primary: string;
          followUps: string[];
        }>;
      }>;
    };

    try {
      // Try to extract JSON from the response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      parsedResponse = JSON.parse(jsonMatch[0]);

      if (!parsedResponse.categories || !Array.isArray(parsedResponse.categories)) {
        throw new Error("Invalid response structure");
      }
    } catch (parseError) {
      console.error("Failed to parse Chatbase response:", parseError);
      console.error("Raw response:", aiResponse);
      return NextResponse.json(
        { error: "Failed to parse generated content. Please try again." },
        { status: 500 }
      );
    }

    // Build a descriptive title from the product name
    const productAnswer = latestNarrative.answers.find(
      (a) => a.question.category === "Product"
    );
    const productName = extractProductName(productAnswer?.answer || "", "Sales");
    const discoveryTitle = `${productName} - Discovery Questions`;

    // Create the version record
    const version = await prisma.discoveryQuestionsVersion.create({
      data: {
        userId: user.id,
        salesNarrativeVersionId: latestNarrative.id,
        title: discoveryTitle,
        content: JSON.stringify(parsedResponse),
      },
    });

    // Update merge variable with the discovery questions
    const formattedContent = formatDiscoveryQuestionsForMerge(parsedResponse);
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "DISCOVERY_QUESTIONS",
        },
      },
      update: {
        value: formattedContent,
      },
      create: {
        userId: user.id,
        mergeField: "DISCOVERY_QUESTIONS",
        name: "Discovery Questions",
        value: formattedContent,
        isDefault: false,
      },
    });

    return NextResponse.json({
      success: true,
      version: {
        id: version.id,
        title: version.title,
        content: parsedResponse,
        salesNarrativeVersionId: version.salesNarrativeVersionId,
        createdAt: version.createdAt,
      },
    });
  } catch (error) {
    console.error("Error generating discovery questions:", error);
    return NextResponse.json(
      { error: "Failed to generate discovery questions" },
      { status: 500 }
    );
  }
}

// Format discovery questions for merge variable
function formatDiscoveryQuestionsForMerge(data: {
  categories: Array<{
    name: string;
    description: string;
    questions: Array<{
      primary: string;
      followUps: string[];
    }>;
  }>;
}): string {
  let output = "";

  for (const category of data.categories) {
    output += `## ${category.name}\n\n`;

    for (let i = 0; i < category.questions.length; i++) {
      const q = category.questions[i];
      output += `${i + 1}. ${q.primary}\n`;

      if (q.followUps && q.followUps.length > 0) {
        for (const followUp of q.followUps) {
          output += `   - ${followUp}\n`;
        }
      }
      output += "\n";
    }
  }

  return output.trim();
}
