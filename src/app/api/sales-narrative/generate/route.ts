import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

// POST - Generate sales narrative from questionnaire answers
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get all enabled questions
    const questions = await prisma.salesNarrativeQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
    });

    // Get user's latest answer for each question
    const latestAnswers = await prisma.$queryRaw<
      Array<{ questionId: string; answer: string; createdAt: Date }>
    >`
      SELECT DISTINCT ON ("questionId") "questionId", "answer", "createdAt"
      FROM "sales_narrative_answers"
      WHERE "userId" = ${user.id}
      ORDER BY "questionId", "createdAt" DESC
    `;

    const answerMap = new Map<string, string>(
      latestAnswers.map((a) => [a.questionId, a.answer])
    );

    // Check if at least some questions are answered
    const answeredCount = latestAnswers.length;
    if (answeredCount === 0) {
      return NextResponse.json(
        { error: "No answers found. Please answer at least some questions before generating." },
        { status: 400 }
      );
    }

    // Build the answers summary for the AI
    const categoryOrder = ["Problem", "Solution", "Proof", "Business"];
    let answersSummary = "";

    for (const category of categoryOrder) {
      const categoryQuestions = questions.filter((q) => q.category === category);
      if (categoryQuestions.length === 0) continue;

      answersSummary += `## ${category}\n\n`;

      for (const q of categoryQuestions) {
        const answer = answerMap.get(q.id);
        answersSummary += `**Q${q.globalOrder}: ${q.question}**\n`;
        if (answer) {
          answersSummary += `${answer}\n\n`;
        } else {
          answersSummary += `_Not answered_\n\n`;
        }
      }
    }

    console.log("Sales narrative answers summary length:", answersSummary.length, "characters");

    // Build the prompt for Chatbase
    const systemPrompt = `You are helping a founder create their sales narrative following the Founding Sales methodology by Pete Kazanjy.

Based on the questionnaire answers below, generate a compelling sales narrative and product descriptions.

## FORMAT REQUIREMENTS

1. **SALES NARRATIVE** - A flowing prose document (NOT bullet points) that weaves the answers into a cohesive, persuasive story. Follow this structure:
   - Open with the problem (make it visceral and relatable)
   - Identify who has the problem and the specific personas affected
   - Quantify the costs of not solving the problem (dollars, time, opportunity cost)
   - Describe how people currently solve it and why those solutions fall short
   - Explain what has changed that enables a new solution
   - Describe how your solution works
   - Provide proof it's better (specific metrics, customer results, social proof)
   - End with pricing positioned as compelling value vs. alternatives

   Use an engaging, conversational tone with urgency around the problem. Include specific numbers and metrics throughout.

2. **100-WORD DESCRIPTION** - A product marketing summary suitable for a website or pitch deck. Covers problem, solution, and key differentiator.

3. **50-WORD DESCRIPTION** - An elevator pitch that can be spoken in ~20 seconds. Problem + solution + why it's better.

4. **25-WORD DESCRIPTION** - A tagline or one-liner that captures the essence.

## QUESTIONNAIRE ANSWERS:

${answersSummary}

---

IMPORTANT: Respond ONLY with valid JSON in this exact format (no markdown code blocks, just raw JSON):
{"narrative": "The full sales narrative as flowing prose...", "description100w": "The 100-word description...", "description50w": "The 50-word description...", "description25w": "The 25-word tagline..."}`;

    // Chatbase has an 8000 character limit per message
    // If the prompt is too long, we need to chunk it
    const CHATBASE_LIMIT = 7500;

    let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let finalMessage = systemPrompt;

    if (systemPrompt.length > CHATBASE_LIMIT) {
      // Split into chunks
      const chunks: string[] = [];
      const sections = answersSummary.split(/(?=## )/);

      let currentChunk = "";
      for (const section of sections) {
        if (currentChunk.length + section.length > CHATBASE_LIMIT - 1000) {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
          }
          currentChunk = section;
        } else {
          currentChunk += section;
        }
      }
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }

      // Add chunks as conversation history
      for (let i = 0; i < chunks.length; i++) {
        chatbaseHistory.push({
          role: "user",
          content: `[Sales Narrative Questionnaire Part ${i + 1} of ${chunks.length}]\n\n${chunks[i]}`,
        });
        if (i < chunks.length - 1) {
          chatbaseHistory.push({
            role: "assistant",
            content: `I've received part ${i + 1}. Please continue with the remaining sections.`,
          });
        }
      }

      // Final message is just the generation instructions
      finalMessage = `Based on all the questionnaire answers I've shared, please generate:

1. A SALES NARRATIVE - Flowing prose (NOT bullets) that tells a compelling story about the problem, who has it, current solutions and their gaps, what changed, how the new solution works, proof it's better, and pricing as value.

2. A 100-WORD DESCRIPTION - Product marketing summary

3. A 50-WORD DESCRIPTION - Elevator pitch

4. A 25-WORD DESCRIPTION - Tagline

IMPORTANT: Respond ONLY with valid JSON (no markdown):
{"narrative": "...", "description100w": "...", "description50w": "...", "description25w": "..."}`;
    }

    console.log(`Sending to Chatbase: ${chatbaseHistory.length} history messages, final message: ${finalMessage.length} chars`);

    // Call Chatbase
    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate narrative. Please try again." },
        { status: 500 }
      );
    }

    // Parse the JSON response
    let parsedResponse: {
      narrative: string;
      description100w: string;
      description50w: string;
      description25w: string;
    };

    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      parsedResponse = JSON.parse(jsonMatch[0]);

      // Validate required fields
      if (!parsedResponse.narrative || !parsedResponse.description100w ||
          !parsedResponse.description50w || !parsedResponse.description25w) {
        throw new Error("Missing required fields in response");
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
    const version = await prisma.salesNarrativeVersion.create({
      data: {
        userId: user.id,
        narrative: parsedResponse.narrative,
        description100w: parsedResponse.description100w,
        description50w: parsedResponse.description50w,
        description25w: parsedResponse.description25w,
      },
    });

    // Create snapshot of all answers linked to this version
    const answerSnapshots = questions.map((q) => ({
      userId: user.id,
      questionId: q.id,
      versionId: version.id,
      answer: answerMap.get(q.id) || "",
    }));

    await prisma.salesNarrativeAnswer.createMany({
      data: answerSnapshots,
    });

    // Update merge variables with the latest narrative outputs
    const mergeVariables = [
      { mergeField: "SALES_NARRATIVE", name: "Sales Narrative", value: parsedResponse.narrative },
      { mergeField: "VALUE_PROP_100W", name: "Value Proposition (100 words)", value: parsedResponse.description100w },
      { mergeField: "VALUE_PROP_50W", name: "Value Proposition (50 words)", value: parsedResponse.description50w },
      { mergeField: "VALUE_PROP_25W", name: "Value Proposition (25 words)", value: parsedResponse.description25w },
    ];

    for (const mv of mergeVariables) {
      await prisma.gtmVariable.upsert({
        where: {
          userId_mergeField: {
            userId: user.id,
            mergeField: mv.mergeField,
          },
        },
        update: {
          value: mv.value,
        },
        create: {
          userId: user.id,
          mergeField: mv.mergeField,
          name: mv.name,
          value: mv.value,
          isDefault: false,
        },
      });
    }

    return NextResponse.json({
      success: true,
      version: {
        id: version.id,
        narrative: version.narrative,
        description100w: version.description100w,
        description50w: version.description50w,
        description25w: version.description25w,
        createdAt: version.createdAt,
      },
      summary: {
        totalQuestions: questions.length,
        answeredCount,
      },
    });
  } catch (error) {
    console.error("Error generating sales narrative:", error);
    return NextResponse.json(
      { error: "Failed to generate narrative" },
      { status: 500 }
    );
  }
}
