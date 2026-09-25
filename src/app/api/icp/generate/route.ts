import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { extractProductName } from "@/lib/extract-product-name";
import { CHATBASE_MESSAGE_LIMIT, splitIntoChunks, buildChunkedHistory } from "@/lib/chatbase/chunking";

// Allow up to 120s for AI generation
export const maxDuration = 120;

// POST - Generate ICP from the latest sales narrative
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

    const instructionPrompt = `You are an expert B2B sales strategist helping founders define their Ideal Customer Profile (ICP).

## OUTPUT FORMAT (CRITICAL — follow this exactly):

Respond with valid JSON in this exact format (no markdown code blocks, no extra text):
{
  "sections": [
    {
      "name": "Section Name",
      "description": "Brief description of this section's purpose",
      "items": ["Item 1", "Item 2", "Item 3"]
    }
  ]
}

## INSTRUCTIONS:

Based on the sales narrative context below, generate a comprehensive Ideal Customer Profile organized into these sections:

1. **Company Characteristics** - Size (employees, revenue), industry/vertical, company stage, geography, tech stack indicators. Be specific with ranges and examples.

2. **Key Personas** - The specific titles/roles you sell to. For each, include their typical responsibilities and why they care about this problem. Format each item as "Title — why they care".

3. **Pain Points & Challenges** - The specific problems these ideal customers face that your solution addresses. Be concrete and tie to business outcomes.

4. **Buying Signals & Triggers** - Observable events or situations that indicate a company is ready to buy. Include hiring patterns, tech changes, funding events, organizational changes.

5. **Qualification Criteria** - Must-have and nice-to-have attributes. What makes a prospect a GREAT fit vs. just an OK fit. Be specific about deal-breakers and green flags.

6. **Red Flags & Disqualifiers** - Signs that a prospect is NOT a good fit. Common time-wasters and patterns to avoid.

Generate 4-8 specific, actionable items per section. Draw directly from the sales narrative context — don't be generic. Reference the actual product, market, and customers described.`;

    const contextSection = `## SALES NARRATIVE:\n\n${latestNarrative.narrative}\n\n## RAW Q&A INPUTS:\n\n${qaInputsSection}`;
    const fullPrompt = `${instructionPrompt}\n\n${contextSection}`;

    let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let finalMessage = fullPrompt;

    if (fullPrompt.length > CHATBASE_MESSAGE_LIMIT) {
      const contextChunks = splitIntoChunks(contextSection, CHATBASE_MESSAGE_LIMIT);
      chatbaseHistory = buildChunkedHistory(contextChunks, "Sales Narrative");
      finalMessage = instructionPrompt;
    }

    // Call Chatbase
    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate ICP. Please try again." },
        { status: 500 }
      );
    }

    // Parse the JSON response
    let parsedResponse: {
      sections: Array<{
        name: string;
        description: string;
        items: string[];
      }>;
    };

    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      parsedResponse = JSON.parse(jsonMatch[0]);

      if (!parsedResponse.sections || !Array.isArray(parsedResponse.sections)) {
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

    // Build a descriptive title
    const productAnswer = latestNarrative.answers.find(
      (a) => a.question.category === "Product"
    );
    const productName = extractProductName(productAnswer?.answer || "", "Sales");
    const icpTitle = `${productName} - Ideal Customer Profile`;

    // Create the version record
    const version = await prisma.icpVersion.create({
      data: {
        userId: user.id,
        salesNarrativeVersionId: latestNarrative.id,
        title: icpTitle,
        content: JSON.stringify(parsedResponse),
      },
    });

    // Update merge variable
    const formattedContent = formatIcpForMerge(parsedResponse);
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "ICP",
        },
      },
      update: {
        value: formattedContent,
      },
      create: {
        userId: user.id,
        mergeField: "ICP",
        name: "Ideal Customer Profile",
        value: formattedContent,
        isDefault: false,
      },
    });

    // Create linked chat conversation
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";
      const icpUrl = `${appUrl}/icp?version=${version.id}`;
      await prisma.conversation.create({
        data: {
          userId: user.id,
          source: "WEB",
          title: `ICP: ${version.title}`,
          firstMessagePreview: "Generate my Ideal Customer Profile",
          messageCount: 2,
          lastMessageAt: new Date(),
          messages: {
            create: [
              { userId: user.id, role: "USER", content: "Generate my Ideal Customer Profile" },
              { role: "ASSISTANT", content: `[View your Ideal Customer Profile](${icpUrl})\n\n**${version.title}**\n\nYour ICP has been generated with ${parsedResponse.sections?.length || 0} sections.` },
            ],
          },
        },
      });
    } catch (e) { console.error("[icp/generate] conversation error:", e); }

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
    console.error("Error generating ICP:", error);
    return NextResponse.json(
      { error: "Failed to generate ICP" },
      { status: 500 }
    );
  }
}

// Format ICP for merge variable
function formatIcpForMerge(data: {
  sections: Array<{
    name: string;
    description: string;
    items: string[];
  }>;
}): string {
  let output = "";
  for (const section of data.sections) {
    output += `## ${section.name}\n`;
    if (section.description) {
      output += `${section.description}\n`;
    }
    output += "\n";
    for (const item of section.items) {
      output += `- ${item}\n`;
    }
    output += "\n";
  }
  return output.trim();
}
