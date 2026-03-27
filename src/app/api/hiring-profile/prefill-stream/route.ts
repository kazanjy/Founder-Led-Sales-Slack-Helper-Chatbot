import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

export const maxDuration = 120;

/**
 * POST /api/hiring-profile/prefill-stream
 * Pre-fills the AE Hiring Profile questionnaire from existing
 * Sales Narrative and GTM Assessment data. Sends each answer
 * as an SSE event so the client can fill fields one at a time.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    // Load hiring profile questions
    const questions = await prisma.hiringProfileQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
      select: { id: true, category: true, globalOrder: true, question: true, helpText: true },
    });

    if (questions.length === 0) {
      return new Response(JSON.stringify({ error: "No questions configured" }), { status: 500 });
    }

    // Load Sales Narrative answers — latest answer per question
    const latestNarrativeAnswers = await prisma.$queryRaw<
      Array<{ questionId: string; answer: string; createdAt: Date }>
    >`
      SELECT DISTINCT ON ("questionId") "questionId", "answer", "createdAt"
      FROM "sales_narrative_answers"
      WHERE "userId" = ${user.id}
      ORDER BY "questionId", "createdAt" DESC
    `;

    // Load GTM Assessment answers — latest answer per question
    const latestMaturityAnswers = await prisma.$queryRaw<
      Array<{ questionId: string; answer: string; createdAt: Date }>
    >`
      SELECT DISTINCT ON ("questionId") "questionId", "answer", "createdAt"
      FROM "maturity_answers"
      WHERE "userId" = ${user.id}
      ORDER BY "questionId", "createdAt" DESC
    `;

    if (latestNarrativeAnswers.length === 0 && latestMaturityAnswers.length === 0) {
      return new Response(
        JSON.stringify({ error: "No existing data found. Please complete the Sales Narrative or GTM Assessment first." }),
        { status: 400 }
      );
    }

    // Load the question text for Sales Narrative and Maturity questions
    const [narrativeQuestions, maturityQuestions] = await Promise.all([
      prisma.salesNarrativeQuestion.findMany({
        where: { enabled: true },
        orderBy: { globalOrder: "asc" },
        select: { id: true, category: true, globalOrder: true, question: true },
      }),
      prisma.maturityQuestion.findMany({
        where: { enabled: true },
        orderBy: { globalOrder: "asc" },
        select: { id: true, category: true, globalOrder: true, question: true },
      }),
    ]);

    // Build answer maps
    const narrativeAnswerMap = new Map<string, string>(
      latestNarrativeAnswers.map((a) => [a.questionId, a.answer])
    );
    const maturityAnswerMap = new Map<string, string>(
      latestMaturityAnswers.map((a) => [a.questionId, a.answer])
    );

    // Build context strings
    const contextParts: string[] = [];
    const dataSources: string[] = [];

    // Sales Narrative context
    const answeredNarrativeQuestions = narrativeQuestions.filter((q) => narrativeAnswerMap.has(q.id));
    if (answeredNarrativeQuestions.length > 0) {
      let narrativeContext = "## SALES NARRATIVE ANSWERS\n\n";
      for (const q of answeredNarrativeQuestions) {
        const answer = narrativeAnswerMap.get(q.id);
        narrativeContext += `**Q${q.globalOrder} [${q.category}]: ${q.question}**\n${answer}\n\n`;
      }
      contextParts.push(narrativeContext);
      dataSources.push(`Sales Narrative (${answeredNarrativeQuestions.length} answers)`);
    }

    // GTM Assessment context
    const answeredMaturityQuestions = maturityQuestions.filter((q) => maturityAnswerMap.has(q.id));
    if (answeredMaturityQuestions.length > 0) {
      let maturityContext = "## GTM ASSESSMENT ANSWERS\n\n";
      for (const q of answeredMaturityQuestions) {
        const answer = maturityAnswerMap.get(q.id);
        maturityContext += `**Q${q.globalOrder} [${q.category}]: ${q.question}**\n${answer}\n\n`;
      }
      contextParts.push(maturityContext);
      dataSources.push(`GTM Assessment (${answeredMaturityQuestions.length} answers)`);
    }

    const combinedContext = contextParts.join("\n\n---\n\n");

    const MAX_CONTEXT_CHARS = 120000;
    const trimmedContext = combinedContext.length > MAX_CONTEXT_CHARS
      ? combinedContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n[Content truncated...]"
      : combinedContext;

    // Set up SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
          // Send source info immediately
          send("sources", { dataSources });

          console.log(`[HiringPrefillStream] Firing ${questions.length} parallel LLM calls`);

          // Fire one LLM call per question — all in parallel
          const promises = questions.map(async (q) => {
            const help = q.helpText ? `\nHint: ${q.helpText}` : "";
            const prompt = `You are helping a founder pre-fill a questionnaire about their current state of sales, so we can build an AE hiring profile. Based on their existing Sales Narrative answers and GTM Assessment answers below, answer this question.

Be aggressive about inferring answers — even if the data doesn't explicitly state the answer, make reasonable inferences from what's available. For example, if the Sales Narrative describes selling to "VP Engineering at mid-market SaaS companies", you can infer the primary buyer title and function. Only leave the answer empty if there is truly NO relevant information at all.

## QUESTION
Q${q.globalOrder} [${q.category}]: ${q.question}${help}

## EXISTING DATA

${trimmedContext}

Respond with ONLY the answer text in plain prose. No JSON, no quotes, no preamble, no markdown formatting (no ** or # or bullets). Write in first person as the founder ("We...", "Our..."). If you truly have zero relevant information, respond with just an empty line.`;

            try {
              const response = await openai.chat.completions.create({
                model: "gpt-5.2",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7,
              });

              const answer = (response.choices[0]?.message?.content || "").trim();
              if (answer) {
                send("answer", { questionId: q.id, answer });
                console.log(`[HiringPrefillStream] Q${q.globalOrder} done (${answer.length} chars)`);
              }
            } catch (err) {
              console.error(`[HiringPrefillStream] Q${q.globalOrder} failed:`, err);
            }
          });

          await Promise.all(promises);
          send("complete", { totalQuestions: questions.length });
        } catch (error) {
          console.error("[HiringPrefillStream] Error:", error);
          send("error", { message: error instanceof Error ? error.message : "Prefill failed" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[HiringPrefillStream] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start prefill" }), { status: 500 });
  }
}
