import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

// POST - Generate discovery questions from the latest sales narrative
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get the latest sales narrative version
    const latestNarrative = await prisma.salesNarrativeVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!latestNarrative) {
      return NextResponse.json(
        { error: "No sales narrative found. Please create a sales narrative first." },
        { status: 400 }
      );
    }

    // Build the prompt for Chatbase
    const systemPrompt = `You are an expert B2B sales coach helping founders create discovery questions for sales calls.

Based on the sales narrative below, generate a comprehensive set of discovery questions that a founder can use during sales calls to understand prospects better and qualify opportunities.

## SALES NARRATIVE:

${latestNarrative.narrative}

## INSTRUCTIONS:

Generate discovery questions organized into the following categories:

1. **Problem Discovery** - Questions to uncover if the prospect experiences the problem your solution addresses, how severe it is, and how it impacts their business.

2. **Current State** - Questions about how they currently handle the problem, what solutions they've tried, and why those aren't working.

3. **Impact & Urgency** - Questions to quantify the cost of the problem (time, money, opportunity cost) and understand timeline/urgency.

4. **Decision Process** - Questions about who else is involved in decisions, budget considerations, and evaluation criteria.

5. **Fit Qualification** - Questions to determine if the prospect is a good fit for your solution based on their situation.

For each category:
- Provide 4-6 specific, open-ended questions
- Include follow-up probing questions where relevant
- Make questions conversational, not interrogative
- Tailor questions to the specific problem/solution in the narrative

## OUTPUT FORMAT:

Respond with valid JSON in this exact format (no markdown code blocks):
{
  "categories": [
    {
      "name": "Problem Discovery",
      "description": "Brief description of this category's purpose",
      "questions": [
        {
          "primary": "The main question to ask",
          "followUps": ["Follow-up 1", "Follow-up 2"]
        }
      ]
    }
  ]
}`;

    console.log(`Sending discovery questions prompt: ${systemPrompt.length} chars`);

    // Call Chatbase
    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(systemPrompt);
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

    // Create the version record
    const version = await prisma.discoveryQuestionsVersion.create({
      data: {
        userId: user.id,
        salesNarrativeVersionId: latestNarrative.id,
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
