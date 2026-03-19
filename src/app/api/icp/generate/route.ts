import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { extractProductName } from "@/lib/extract-product-name";
import { CHATBASE_MESSAGE_LIMIT, splitIntoChunks, buildChunkedHistory } from "@/lib/chatbase/chunking";

export const maxDuration = 120;

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

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

    const instructionPrompt = `You are an expert B2B sales strategist helping founders define their Ideal Customer Profile (ICP).

## OUTPUT FORMAT (CRITICAL — follow this exactly):

Respond with valid JSON in this exact format (no markdown code blocks, no extra text):
{
  "segments": [
    {
      "name": "Segment Name (e.g. 'Growth-Stage SaaS Companies')",
      "description": "2-3 sentence description of this organization type and why they're ideal",
      "firmographic": {
        "companySize": "Employee count range",
        "industry": "Target industries/verticals",
        "revenue": "Revenue or ARR range",
        "geography": "Target regions",
        "stage": "Company stage (startup, growth, enterprise, etc.)"
      },
      "technographic": {
        "currentTools": ["Tools/platforms they likely use"],
        "techMaturity": "Their technology adoption level",
        "integrationNeeds": "What integrations matter to them"
      },
      "timingTriggers": ["Events or changes that create buying urgency"],
      "painPoints": ["Organization-level pain points"],
      "buyingPersonas": [
        {
          "title": "Job Title",
          "role": "Champion, Decision Maker, Influencer, or End User",
          "motivation": "What drives this person professionally",
          "painPoints": ["Their specific pain points related to the problem"],
          "objections": ["Common objections this persona raises"],
          "emotionalDriver": "The underlying emotional need"
        }
      ]
    }
  ]
}

## INSTRUCTIONS:

Generate an Ideal Customer Profile with 3-5 organizational segments. For each segment:

1. **Organizational Profile** — Define the type of company with specific firmographic criteria (size, industry, revenue, geography, stage) and technographic indicators (tools, maturity, integration needs). Include timing triggers that create buying urgency.

2. **Buying Personas** — For EACH org segment, specify 3-5 human personas who participate in the purchasing decision. These personas should be SPECIFIC to that segment (titles and roles often differ by company size/type). Include:
   - Their job title (specific to this segment size/type)
   - Their role in the buying process
   - What motivates them
   - Their specific pain points
   - Common objections they raise
   - Their emotional driver

3. **Timing Triggers** — What events, changes, or circumstances create urgency? Think about: leadership changes, funding rounds, failed implementations, regulatory changes, growth milestones, etc.

Make everything specific to the product/solution described. Avoid generic advice. Each segment should feel distinct and actionable for a sales team.`;

    const contextSection = `## SALES NARRATIVE:\n\n${latestNarrative.narrative}`;
    const fullPrompt = `${instructionPrompt}\n\n${contextSection}`;

    let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let finalMessage = fullPrompt;

    if (fullPrompt.length > CHATBASE_MESSAGE_LIMIT) {
      const contextChunks = splitIntoChunks(contextSection, CHATBASE_MESSAGE_LIMIT);
      chatbaseHistory = buildChunkedHistory(contextChunks, "Sales Narrative");
      finalMessage = instructionPrompt;
    }

    console.log(`Sending ICP prompt: ${finalMessage.length} chars (history: ${chatbaseHistory.length} msgs)`);

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

    let parsedResponse: {
      segments: Array<{
        name: string;
        description: string;
        firmographic: {
          companySize: string;
          industry: string;
          revenue: string;
          geography: string;
          stage: string;
        };
        technographic: {
          currentTools: string[];
          techMaturity: string;
          integrationNeeds: string;
        };
        timingTriggers: string[];
        painPoints: string[];
        buyingPersonas: Array<{
          title: string;
          role: string;
          motivation: string;
          painPoints: string[];
          objections: string[];
          emotionalDriver: string;
        }>;
      }>;
    };

    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      parsedResponse = JSON.parse(jsonMatch[0]);

      if (!parsedResponse.segments || !Array.isArray(parsedResponse.segments)) {
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

    const productAnswer = latestNarrative.answers.find(
      (a) => a.question.category === "Product"
    );
    const productName = extractProductName(productAnswer?.answer || "", "Sales");
    const icpTitle = `${productName} - Ideal Customer Profile`;

    const version = await prisma.iCPVersion.create({
      data: {
        userId: user.id,
        salesNarrativeVersionId: latestNarrative.id,
        title: icpTitle,
        content: JSON.stringify(parsedResponse),
      },
    });

    // Update merge variable with the ICP
    const formattedContent = formatICPForMerge(parsedResponse);
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

function formatICPForMerge(data: {
  segments: Array<{
    name: string;
    description: string;
    firmographic: {
      companySize: string;
      industry: string;
      revenue: string;
      geography: string;
      stage: string;
    };
    technographic: {
      currentTools: string[];
      techMaturity: string;
      integrationNeeds: string;
    };
    timingTriggers: string[];
    painPoints: string[];
    buyingPersonas: Array<{
      title: string;
      role: string;
      motivation: string;
      painPoints: string[];
      objections: string[];
      emotionalDriver: string;
    }>;
  }>;
}): string {
  let output = "";

  for (const segment of data.segments) {
    output += `## ${segment.name}\n\n`;
    output += `${segment.description}\n\n`;
    output += `**Firmographic:** ${segment.firmographic.industry} | ${segment.firmographic.companySize} | ${segment.firmographic.revenue} | ${segment.firmographic.stage}\n`;
    output += `**Technographic:** ${segment.technographic.techMaturity} | Tools: ${segment.technographic.currentTools.join(", ")}\n`;
    output += `**Timing Triggers:** ${segment.timingTriggers.join("; ")}\n`;
    output += `**Pain Points:** ${segment.painPoints.join("; ")}\n\n`;
    output += `### Buying Personas\n\n`;

    for (const persona of segment.buyingPersonas) {
      output += `- **${persona.title}** (${persona.role}): ${persona.motivation}\n`;
    }
    output += "\n";
  }

  return output.trim();
}
