import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { extractProductName } from "@/lib/extract-product-name";

// Allow up to 120s for Chatbase AI generation
export const maxDuration = 120;

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

    // Get the latest ICP if available
    const latestICP = await prisma.icpVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    let icpSection = "";
    if (latestICP) {
      try {
        const icpContent = JSON.parse(latestICP.content);
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

    const narrative = latestDiscoveryQuestions.salesNarrativeVersion;

    // Format discovery questions concisely (just the primary questions)
    let discoveryQuestionsSection = "";
    for (const category of discoveryQuestionsContent.categories) {
      discoveryQuestionsSection += `**${category.name}:** `;
      discoveryQuestionsSection += category.questions.map(q => q.primary).join(" | ");
      discoveryQuestionsSection += "\n";
    }

    // Build multi-message conversation to stay within Chatbase's 7500-char limit.
    // Examples go in history, instructions + company context go in the final message.
    const example1 = `Here is EXAMPLE 1 of a great First Call Checklist (Julius, AI-native BI tool). Study the structure and depth:

# Julius - First Call Checklist

## PART 1 — Persona Reference Library

### A. Organizational Personas
| Organizational Persona | Description / Current State | Typical Needs / Goals | Common Challenges |
|---|---|---|---|
| Startup Engineering / Growth Leader | No data team. Eng team gets insights for themselves or marketing/GTM/execs | Save time. Stop distracting eng | No data best practices. Very resource constrained. |
| Head of Data at startup | Small data team (1-5). Time spent on ad-hoc questions. Probably not decision maker. | Overwhelmed by ad-hoc requests and reporting. | Juggling multiple data tools. No time to build solutions. |
| Head of Data at Scale Up | Larger team, combo of tools. Can be decision-maker for smaller deals. | Tons of tickets. Internal data initiatives slow. Adoption difficult. | Adoption takes time. More need for governance. |

### B. Individual Personas
| Role | Motivation | Common Pains | Objections | Emotional Driver |
|---|---|---|---|---|
| Head of Data | Execs get answers. Lower ticket response time. | Ad-hoc requests. No time for strategic work. | Invested in other tools. No purchase authority. Accuracy concerns. | Seat at the table with leadership. |
| Data Analyst | Offload repetitive tasks. More impactful work. | Endless tickets. Same questions repeated. | Don't want more setup work. | Save time on tickets and meetings. |
| Head of Growth | Use AI for expansion pathways. | Non-technical team. Slow responses. | Have other tools. Wrong answers worry. | Drive top-line impact. |

## PART 2 — First Call Checklist

### 1. Pre-Call Planning
- Which org persona? Which human persona? Likely budget owner?
- Research: existing usage, lead source, connection points, motivations
- Persona selection template (org type, current state, hypothesized needs; role, seniority, motivations, objections)
- Internal call objectives: Do they have our problem? Right person? Quick process or just fishing?

### 2. Rapport & Introduction (3 min)
- Icebreaker: "Where are you calling in from?"
- Intro with credibility: "[Product] is [one-line positioning]. We help [target] do [outcome]. Over [timeframe] we've built [social proof metrics]."
- Agenda set: "Good goal for us today is to figure out if [Product] is a good fit. If yes, we'll discuss next steps. Sound okay?"

### 3. Discovery (15 min)
- "Where does your data live today?" → follow-ups based on answer
- "What burning unanswered questions would you like answered?"
- "Can you take me through how an ad-hoc question gets answered now?"
- [NEED/AUTHORITY] "Who else shares these pain points?"
- [BUDGET] "Is there anyone else we'd need to loop in?"
- [TIMELINE] "What makes this a need now?"
- Signals of pain to listen for, with follow-up prompts
- Closing if fit / Closing if no fit`;

    const example2 = `Here is EXAMPLE 2 of a great First Call Checklist (Synthesis, AI-powered SLR verification). Note the persona-specific variants and detailed scripts:

## Part 1 — Persona Reference Library
### A. Organizational Personas (CRO/HEOR Consultancy vs Pharma/Biotech)
### B. Individual Personas with 5 columns: Role, Motivation, Pains, Objections, Emotional Driver
### C. Background Modifiers table (Pure Research, Research+AI, Pure AI/Tech, etc.) showing how to adjust approach

## Part 2 — First Call Checklist
### 1. Pre-Call Planning
- THE BIG QUESTION: What is your angle for this org persona and human persona?
- Pre-call research steps: lead source, org persona ID, human persona ID, background modifier, pain hypothesis, social proof selection, anticipated objections, exit intention
- Scratchpad template (fill per call)
- Internal call objectives (persona-specific): CRO×Research, CRO×AI, Pharma×Research, Pharma×AI
- Universal success criteria: identify pains, confirm decision process, qualify volume, secure next step

### 2. Rapport & Introduction (<5 min)
- Persona-specific icebreakers (reference their published work, not generic LinkedIn talk)
- Intro scripts with DIFFERENT credibility framing per persona (Research vs AI)
- Agenda set: "Learn about your process, show validation results if fit, discuss verification project. If not a fit, give you back your time."
- "Is there something specific you wanted to discuss today?"

### 3. Discovery (~15-20 min)
- 5 must-ask questions, each with "why we ask this" + persona-specific variants + follow-ups
- Signal check: Do they have pain? Can they buy? Is there urgency?
- Disqualification script (graceful no-fit exit)

### 4. Narrative Positioning
- Elevator pitch tailored to discovery answers
- Bridge language table: Persona Pairing → specific value framing
- Strategic framing rules (never say X, always lead with Y)
- Persona-matched social proof`;

    const mainPrompt = `Generate a First Call Checklist for the company below, following the structure and depth from the examples above. Return raw markdown (NO code blocks).

## REQUIRED SECTIONS:

1. **Persona Reference Library** — Org personas table (3-4 types) + Individual personas table (4-5 roles) with columns: Role, Motivation, Pains, Objections, Emotional Driver. Optional: Background modifiers.

2. **Pre-Call Planning Process** — Research steps, persona selection template (fill-in), internal call objectives (persona-specific + universal).

3. **Rapport & Introduction** — Icebreaker strategies, intro script with credibility framing, agenda set language. All specific to THIS product.

4. **Discovery Section** — 5-8 must-ask questions with "why we ask this", persona-specific variants, follow-up prompts, signals of pain. Include disqualification criteria and graceful exit script.

5. **Opportunity Evaluation** — Post-call qualification criteria, next step options, closing language for fit and no-fit.

Make everything specific and actionable — include verbatim scripts, not generic advice.

---

## SALES NARRATIVE:

${narrative?.narrative ?? "No sales narrative available."}

## DISCOVERY QUESTIONS:

${discoveryQuestionsSection}${icpSection ? `\n\n## IDEAL CUSTOMER PROFILE:\n\n${icpSection}` : ""}`;

    console.log(`Sending first call checklist prompt: ${mainPrompt.length} chars (+ ${example1.length} + ${example2.length} chars in history)`);

    // Call Chatbase with examples as conversation history to stay within per-message limits
    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(mainPrompt, undefined, [
        { role: "user" as const, content: example1 },
        { role: "assistant" as const, content: "I've studied Example 1 (Julius). I see the structure: Persona Reference Library with org + individual persona tables, Pre-Call Planning with research steps and persona selection template, Rapport & Introduction with credibility framing and agenda set, Discovery with must-ask questions and follow-ups, and closing scripts. Ready for Example 2." },
        { role: "user" as const, content: example2 },
        { role: "assistant" as const, content: "I've studied Example 2 (Synthesis). I see the additional depth: background modifiers, persona-specific intro scripts, 'why we ask this' for each question, signal check framework, disqualification script, narrative positioning with bridge language table, and strategic framing rules. I'm ready to generate a First Call Checklist with this level of detail." },
      ]);
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

    // Build a descriptive title from the product name
    const productAnswer = narrative?.answers?.find(
      (a) => a.question.category === "Product"
    );
    const productName = extractProductName(productAnswer?.answer || "", "Sales");
    const checklistTitle = `${productName} - First Call Checklist`;

    // Create the version record
    const version = await prisma.firstCallChecklistVersion.create({
      data: {
        userId: user.id,
        discoveryQuestionsVersionId: latestDiscoveryQuestions.id,
        title: checklistTitle,
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

    // Create linked chat conversation
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";
      const fccUrl = `${appUrl}/first-call-checklist?version=${version.id}`;
      await prisma.conversation.create({
        data: {
          userId: user.id,
          source: "WEB",
          title: `First Call Checklist: ${version.title}`,
          firstMessagePreview: "Generate my First Call Checklist",
          messageCount: 2,
          lastMessageAt: new Date(),
          messages: {
            create: [
              { userId: user.id, role: "USER", content: "Generate my First Call Checklist" },
              { role: "ASSISTANT", content: `[View your First Call Checklist](${fccUrl})\n\n**${version.title}**\n\n${cleanedResponse.substring(0, 500)}${cleanedResponse.length > 500 ? "..." : ""}` },
            ],
          },
        },
      });
    } catch (e) { console.error("[first-call-checklist/generate] conversation error:", e); }

    return NextResponse.json({
      success: true,
      version: {
        id: version.id,
        title: version.title,
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
