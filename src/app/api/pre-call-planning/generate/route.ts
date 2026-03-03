import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

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

    // Build the Q&A inputs section from the sales narrative
    const narrative = latestChecklist.discoveryQuestionsVersion.salesNarrativeVersion;
    const categoryOrder = ["Product", "Problem", "Solution", "Proof", "Business"];
    let qaInputsSection = "";

    for (const category of categoryOrder) {
      const categoryAnswers = narrative.answers.filter(
        (a) => a.question.category === category
      );
      if (categoryAnswers.length === 0) continue;

      qaInputsSection += `### ${category}\n\n`;
      for (const answer of categoryAnswers) {
        qaInputsSection += `**Q${answer.question.globalOrder}: ${answer.question.question}**\n`;
        qaInputsSection += `${answer.answer || "_Not answered_"}\n\n`;
      }
    }

    // Parse and format the discovery questions
    let discoveryQuestionsSection = "";
    try {
      const discoveryQuestionsContent = JSON.parse(latestChecklist.discoveryQuestionsVersion.content);
      for (const category of discoveryQuestionsContent.categories) {
        discoveryQuestionsSection += `### ${category.name}\n`;
        for (let i = 0; i < category.questions.length; i++) {
          const q = category.questions[i];
          discoveryQuestionsSection += `${i + 1}. ${q.primary}\n`;
          if (q.followUps && q.followUps.length > 0) {
            for (const followUp of q.followUps) {
              discoveryQuestionsSection += `   - ${followUp}\n`;
            }
          }
        }
        discoveryQuestionsSection += "\n";
      }
    } catch {
      discoveryQuestionsSection = latestChecklist.discoveryQuestionsVersion.content;
    }

    // Build the prompt for Chatbase
    const systemPrompt = `You are an expert B2B sales coach specializing in pre-call preparation and planning processes for founders.

## YOUR GOAL

Generate a comprehensive, standalone Pre-Call Planning Process document that a founder can use BEFORE EVERY sales call to systematically prepare. This is NOT the call checklist itself — it's the preparation ritual and research process that happens BEFORE the call starts.

The First Call Checklist already tells them what to DO on the call. This document tells them how to PREPARE for it.

## YOUR TASK

Generate a Pre-Call Planning Process for the company described below. Your document should include:

1. **Research Framework** — A step-by-step process for researching each prospect before a call. Include specific places to look, what to look for, and how to organize findings. Cover:
   - Company research (size, stage, funding, tech stack, recent news, job postings)
   - Individual prospect research (role, tenure, LinkedIn activity, published content, career trajectory)
   - Competitive landscape research (what tools/solutions they currently use, recent vendor evaluations)
   - Industry/market context research (trends affecting their business, regulatory changes, market shifts)

2. **Prospect Intelligence Template** — A fill-in-the-blank template the founder can complete for each prospect. Include fields for:
   - Company snapshot (industry, size, stage, key metrics)
   - Prospect profile (name, role, background, likely motivations)
   - Hypothesized pain points (based on persona matching from the First Call Checklist)
   - Connection points (shared contacts, shared interests, relevant experience)
   - Competitive context (current solutions, likely alternatives being evaluated)

3. **Persona Matching Process** — How to use the persona libraries from the First Call Checklist to match each prospect:
   - Step-by-step process for identifying organizational persona
   - Step-by-step process for identifying individual persona
   - How to adjust approach based on persona combination
   - Red flags that suggest persona mismatch

4. **Call Objective Setting** — A framework for defining what success looks like BEFORE each call:
   - Primary objective (the one thing that must happen)
   - Secondary objectives (nice-to-haves)
   - Minimum viable outcome (the least acceptable result)
   - Disqualification criteria (when to end the call early)
   - Next step options (pre-planned based on call outcome scenarios)

5. **Opening Strategy Preparation** — How to prepare the first 3 minutes:
   - Rapport hooks to research and prepare (specific to this prospect)
   - Credibility statement customization (which proof points to lead with)
   - Agenda framing (how to position the call purpose)
   - Permission-based opening (how to establish collaborative tone)

6. **Question Sequencing Plan** — How to prepare the discovery portion:
   - Which questions from the Discovery Questions to prioritize for THIS prospect
   - Persona-specific question variants to prepare
   - Follow-up question trees to anticipate
   - Signals of pain to listen for (customized to this prospect's likely situation)

7. **Objection Preparation** — Pre-call objection readiness:
   - Most likely objections based on persona
   - Prepared responses for each
   - Bridge statements to redirect conversations
   - When to acknowledge vs. when to challenge

8. **Logistics & Environment Checklist** — The practical preparation:
   - Technology setup (video, screen share, CRM open, notes template ready)
   - Environment (quiet space, professional background, lighting)
   - Materials (one-pager, case study, demo environment)
   - Timing (buffer before call, calendar holds after for notes)
   - Mental preparation (confidence routine, energy management)

9. **Post-Call Protocol** — What to do in the 15 minutes immediately after:
   - Note-taking template (what to capture)
   - CRM update checklist
   - Follow-up email template
   - Internal debrief template (what went well, what to improve)
   - Next step execution (send what was promised, schedule what was agreed)

Make the process specific and actionable for THIS company's unique value proposition, target market, and sales motion. Reference the personas, questions, and strategies from their First Call Checklist. Include specific templates they can print and fill in.

DO NOT wrap the output in code blocks. Just return the raw markdown.

---

## COMPANY CONTEXT

### FIRST CALL CHECKLIST:

${latestChecklist.content}

### SALES NARRATIVE:

${narrative.narrative}

### QUESTIONNAIRE INPUTS (Raw Q&A):

${qaInputsSection}

### DISCOVERY QUESTIONS:

${discoveryQuestionsSection}

---

Now generate a comprehensive Pre-Call Planning Process document for this company, following the structure outlined above. Make it specific, actionable, and immediately usable.`;

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

    // Create the version record
    const version = await prisma.preCallPlanningVersion.create({
      data: {
        userId: user.id,
        firstCallChecklistVersionId: latestChecklist.id,
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
