import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

// Allow up to 120s for GPT-5.2 generation
export const maxDuration = 120;

// POST - Generate AE Hiring Profile from questionnaire answers
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get all enabled questions
    const questions = await prisma.hiringProfileQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
    });

    // Get user's latest answer for each question
    const latestAnswers = await prisma.$queryRaw<
      Array<{ questionId: string; answer: string; createdAt: Date }>
    >`
      SELECT DISTINCT ON ("questionId") "questionId", "answer", "createdAt"
      FROM "hiring_profile_answers"
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

    // Build the answers summary for the AI, grouped by category
    const seenCategories: string[] = [];
    for (const q of questions) {
      if (!seenCategories.includes(q.category)) {
        seenCategories.push(q.category);
      }
    }

    let answersSummary = "";
    for (const category of seenCategories) {
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

    console.log("Hiring profile answers summary length:", answersSummary.length, "characters");

    const prompt = `You are an expert sales hiring consultant helping a founder define their ideal first (or next) Account Executive hire. Based on the founder's answers below, generate a comprehensive AE Hiring Profile report.

## QUESTIONNAIRE ANSWERS:

${answersSummary}

---

## OUTPUT REQUIREMENTS

Generate a detailed AE Hiring Profile report in **Markdown format** with the following sections. Each section should have a level-2 heading (##). Be specific and actionable based on the founder's answers — avoid generic advice.

### Required Sections:

## Role Summary
A 2-3 paragraph overview of the AE role, including the sales motion, target market, and what makes this role unique.

## Ideal Background
Industries, company stages, deal sizes, and types of selling experience that would translate well. Be specific about what "good" looks like.

## Must-Have Experience
Bullet list of non-negotiable experience and skills. These should be directly tied to the founder's sales motion and market.

## Nice-to-Have Experience
Bullet list of additional experience that would be valuable but not required.

## Where to Look
Specific companies to poach from, LinkedIn search criteria, communities, events, and other sourcing channels. Be as concrete as possible.

## Red Flags
Backgrounds that look good on paper but are actually bad fits for this specific role. Explain WHY each is a red flag.

## Interview Focus Areas
Key areas to probe during interviews, with suggested questions or evaluation criteria for each.

## Comp Expectations
Suggested OTE range and base/variable split, with reasoning based on the role complexity, market, and deal size.

---

Respond ONLY with valid JSON (no markdown code blocks):
{"title": "AE Hiring Profile - [brief descriptor]", "content": "The full markdown report..."}`;

    console.log(`Sending GPT-5.2 call for hiring profile: ${prompt.length} chars`);

    let raw = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.5",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      });
      raw = response.choices[0]?.message?.content || "";
    } catch (gptError) {
      console.error("GPT-5.2 API error:", gptError);
      const errorMessage = gptError instanceof Error ? gptError.message : "Unknown error";
      return NextResponse.json(
        { error: `Failed to generate hiring profile: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Parse JSON response
    let parsedResponse: { title: string; content: string };
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      parsedResponse = JSON.parse(jsonMatch[0]);

      if (!parsedResponse.title || !parsedResponse.content) {
        throw new Error("Missing required fields in response");
      }
    } catch (parseError) {
      console.error("Failed to parse GPT-5.2 response:", parseError);
      console.error("Raw:", raw.substring(0, 500));
      return NextResponse.json(
        { error: "Failed to parse generated content. Please try again." },
        { status: 500 }
      );
    }

    // Create the version record
    const version = await prisma.hiringProfileVersion.create({
      data: {
        userId: user.id,
        title: parsedResponse.title,
        content: parsedResponse.content,
      },
    });

    // Create answer snapshots
    const answerSnapshots = questions.map((q) => ({
      userId: user.id,
      questionId: q.id,
      versionId: version.id,
      answer: answerMap.get(q.id) || "",
    }));

    await prisma.hiringProfileAnswer.createMany({ data: answerSnapshots });

    return NextResponse.json({
      success: true,
      version: {
        id: version.id,
        title: version.title,
        content: version.content,
        iterationHistory: version.iterationHistory,
        createdAt: version.createdAt,
      },
      summary: {
        totalQuestions: questions.length,
        answeredCount,
      },
    });
  } catch (error) {
    console.error("Error generating hiring profile:", error);
    return NextResponse.json(
      { error: "Failed to generate hiring profile" },
      { status: 500 }
    );
  }
}
