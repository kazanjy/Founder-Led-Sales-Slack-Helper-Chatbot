import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

// Allow up to 120s for Chatbase AI generation
export const maxDuration = 120;

// POST - Generate pre-call planning process from first call checklist, discovery questions, and sales narrative
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get the latest first call checklist version with its full parent chain
    const latestChecklist = await prisma.firstCallChecklistVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        discoveryQuestionsVersion: {
          include: {
            salesNarrativeVersion: {
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
            },
          },
        },
      },
    });

    if (!latestChecklist) {
      return NextResponse.json(
        { error: "No first call checklist found. Please generate a first call checklist first." },
        { status: 400 }
      );
    }

    const narrative = latestChecklist.discoveryQuestionsVersion?.salesNarrativeVersion;

    // Build the prompt for Chatbase
    // IMPORTANT: Instructions come FIRST so they survive if the message gets truncated.
    // The First Call Checklist already contains distilled info from the narrative, Q&A, and
    // discovery questions, so we only include the checklist + narrative (skip raw Q&A and
    // discovery questions to stay within the 7500-char Chatbase limit).
    const systemPrompt = `You are an expert B2B sales coach. Generate a Pre-Call Planning Process — the preparation ritual a founder uses BEFORE every sales call. This is NOT the call itself; it's how to PREPARE.

## OUTPUT REQUIREMENTS
- Return raw markdown (NO code blocks)
- Be specific to THIS company's value prop, market, and sales motion
- Reference personas/strategies from the First Call Checklist below
- Include fillable templates

## DOCUMENT STRUCTURE (include all 9 sections):

1. **Research Framework** — Step-by-step process for researching each prospect: company info, individual prospect, competitive landscape, industry context.

2. **Prospect Intelligence Template** — Fill-in template: company snapshot, prospect profile, hypothesized pain points, connection points, competitive context.

3. **Persona Matching Process** — How to identify organizational and individual personas, adjust approach, spot red flags.

4. **Call Objective Setting** — Framework: primary objective, secondary objectives, minimum viable outcome, disqualification criteria, pre-planned next steps.

5. **Opening Strategy Preparation** — First 3 minutes: rapport hooks, credibility statement, agenda framing, permission-based opening.

6. **Question Sequencing Plan** — Which discovery questions to prioritize, persona-specific variants, follow-up trees, pain signals.

7. **Objection Preparation** — Likely objections by persona, prepared responses, bridge statements.

8. **Logistics & Environment Checklist** — Tech setup, environment, materials, timing, mental prep.

9. **Post-Call Protocol** — Note-taking template, CRM updates, follow-up email, debrief, next step execution.

---

## FIRST CALL CHECKLIST:

${latestChecklist.content}

## SALES NARRATIVE:

${narrative?.narrative ?? "No sales narrative available."}

---

Generate the Pre-Call Planning Process now.`;

    console.log(`Sending pre-call planning prompt: ${systemPrompt.length} chars`);

    // Call Chatbase
    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(systemPrompt);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate pre-call planning process. Please try again." },
        { status: 500 }
      );
    }

    // Clean up the response - remove any code block wrappers
    let cleanedResponse = aiResponse.trim();
    if (cleanedResponse.startsWith("```markdown")) {
      cleanedResponse = cleanedResponse.slice(11);
    } else if (cleanedResponse.startsWith("```")) {
      cleanedResponse = cleanedResponse.slice(3);
    }
    if (cleanedResponse.endsWith("```")) {
      cleanedResponse = cleanedResponse.slice(0, -3);
    }
    cleanedResponse = cleanedResponse.trim();

    // Build a descriptive title from the product name
    const productAnswer = narrative?.answers?.find(
      (a) => a.question.category === "Product"
    );
    const productName = productAnswer?.answer || "Sales";
    const planningTitle = `${productName} - Pre-Call Planning`;

    // Create the version record
    const version = await prisma.preCallPlanningVersion.create({
      data: {
        userId: user.id,
        firstCallChecklistVersionId: latestChecklist.id,
        title: planningTitle,
        content: cleanedResponse,
      },
    });

    // Update merge variable with the pre-call planning process
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "PRE_CALL_PLANNING",
        },
      },
      update: {
        value: cleanedResponse,
      },
      create: {
        userId: user.id,
        mergeField: "PRE_CALL_PLANNING",
        name: "Pre-Call Planning Process",
        value: cleanedResponse,
        isDefault: false,
      },
    });

    return NextResponse.json({
      success: true,
      version: {
        id: version.id,
        title: version.title,
        content: cleanedResponse,
        firstCallChecklistVersionId: version.firstCallChecklistVersionId,
        createdAt: version.createdAt,
      },
    });
  } catch (error) {
    console.error("Error generating pre-call planning process:", error);
    return NextResponse.json(
      { error: "Failed to generate pre-call planning process" },
      { status: 500 }
    );
  }
}
