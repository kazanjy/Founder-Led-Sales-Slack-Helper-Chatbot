import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

// POST - Generate first call checklist from discovery questions and sales narrative
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get the latest discovery questions version with its sales narrative
    const latestDiscoveryQuestions = await prisma.discoveryQuestionsVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
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
    });

    if (!latestDiscoveryQuestions) {
      return NextResponse.json(
        { error: "No discovery questions found. Please generate discovery questions first." },
        { status: 400 }
      );
    }

    // Parse the discovery questions content
    let discoveryQuestionsContent: {
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
      discoveryQuestionsContent = JSON.parse(latestDiscoveryQuestions.content);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse discovery questions. Please regenerate them." },
        { status: 400 }
      );
    }

    // Build the Q&A inputs section from the sales narrative
    const narrative = latestDiscoveryQuestions.salesNarrativeVersion;
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

    // Format discovery questions for the prompt
    let discoveryQuestionsSection = "";
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

    // Build the prompt for Chatbase
    const systemPrompt = `You are an expert B2B sales coach helping founders prepare for their first sales calls with prospects.

Based on the sales narrative, questionnaire inputs, and discovery questions below, generate a comprehensive First Call Checklist that a founder can use to prepare for and execute their first call with a prospect.

## SALES NARRATIVE:

${narrative.narrative}

## QUESTIONNAIRE INPUTS (Raw Q&A):

${qaInputsSection}

## DISCOVERY QUESTIONS:

${discoveryQuestionsSection}

## TEMPLATE STRUCTURE:

Generate a First Call Checklist following this exact structure:

---

# FIRST CALL CHECKLIST

## Persona Library

For each target persona identified in the sales narrative, create a brief profile:

**[Persona Title 1]**
- Pain Points: [Specific frustrations relevant to this persona]
- Goals: [What they're trying to achieve]
- Language: [Key phrases/terminology they use]

**[Persona Title 2]**
(repeat for 2-4 key personas)

---

## SECTION 1: GOALS

Provide these as empty checkboxes for the user to fill in:

- [ ] Primary objective for this call
- [ ] Secondary objective
- [ ] Information to gather
- [ ] Specific outcome to achieve

---

## SECTION 2: RESEARCH SUMMARY

Create a template with prompts for company research:

**Company Overview**
- Company: [Placeholder for company name]
- Industry: [Placeholder]
- Size: [Placeholder]
- Recent News: [Placeholder for recent developments to discuss]

**Contact Information**
- Name: [Placeholder]
- Title: [Placeholder]
- LinkedIn: [Placeholder]
- Background Notes: [Placeholder for relevant background]

---

## SECTION 3: DISCOVERY QUESTIONS

Select and organize 8-12 of the most important discovery questions from the provided list. Group them into:

**Opening Questions** (2-3 questions to build rapport and understand context)

**Problem Discovery** (3-4 questions to uncover pain points)

**Impact Questions** (2-3 questions to quantify the problem)

**Fit Questions** (2-3 questions to qualify the opportunity)

---

## SECTION 4: DECISION-MAKING PROCESS

Provide questions and checkboxes to understand their buying process:

**Questions to Ask:**
- Who else should be involved in evaluating this?
- What's your timeline for making a decision?
- What criteria will you use to evaluate solutions?
- What's the process for getting budget approval?

**Capture:**
- [ ] Decision Maker(s): [Placeholder]
- [ ] Timeline: [Placeholder]
- [ ] Budget Authority: [Placeholder]
- [ ] Buying Process: [Placeholder]

---

## SECTION 5: AGENDA

Provide a suggested call agenda with time allocations:

**Suggested Call Agenda (30 min)**

| Time | Topic | Notes |
|------|-------|-------|
| 0-2 min | Intro & Rapport | [Brief icebreaker] |
| 2-5 min | Confirm Agenda | "Here's what I'd like to cover..." |
| 5-15 min | Discovery | Focus on pain points and impact |
| 15-20 min | Solution Preview | Brief overview, not a demo |
| 20-25 min | Q&A | Answer their questions |
| 25-30 min | Next Steps | Clear action items |

---

## SECTION 6: OPPORTUNITY EVALUATION

Post-call checklist to assess the opportunity:

**Qualification Criteria:**
- [ ] Has a clear problem we solve
- [ ] Has budget or access to budget
- [ ] Has authority or access to decision maker
- [ ] Has a timeline or compelling event
- [ ] Is a good fit for our solution

**Call Rating:** [ ] Hot [ ] Warm [ ] Cold [ ] Not a Fit

**Next Steps:**
- [ ] [Action item 1]
- [ ] [Action item 2]
- [ ] [Follow-up scheduled for: ___]

---

## OUTPUT FORMAT:

Return the complete checklist as markdown text. Use proper markdown formatting with headers, bullet points, checkboxes, and tables.

DO NOT wrap the output in code blocks. Just return the raw markdown.`;

    console.log(`Sending first call checklist prompt: ${systemPrompt.length} chars`);

    // Call Chatbase
    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(systemPrompt);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate first call checklist. Please try again." },
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
    const version = await prisma.firstCallChecklistVersion.create({
      data: {
        userId: user.id,
        discoveryQuestionsVersionId: latestDiscoveryQuestions.id,
        content: cleanedResponse,
      },
    });

    // Update merge variable with the first call checklist
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "FIRST_CALL_CHECKLIST",
        },
      },
      update: {
        value: cleanedResponse,
      },
      create: {
        userId: user.id,
        mergeField: "FIRST_CALL_CHECKLIST",
        name: "First Call Checklist",
        value: cleanedResponse,
        isDefault: false,
      },
    });

    return NextResponse.json({
      success: true,
      version: {
        id: version.id,
        content: cleanedResponse,
        discoveryQuestionsVersionId: version.discoveryQuestionsVersionId,
        createdAt: version.createdAt,
      },
    });
  } catch (error) {
    console.error("Error generating first call checklist:", error);
    return NextResponse.json(
      { error: "Failed to generate first call checklist" },
      { status: 500 }
    );
  }
}
