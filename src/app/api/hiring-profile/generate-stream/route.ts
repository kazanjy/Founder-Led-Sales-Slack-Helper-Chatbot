import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

export const maxDuration = 180;

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    const questions = await prisma.hiringProfileQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
    });

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

    if (latestAnswers.length === 0) {
      return new Response(JSON.stringify({ error: "No answers found" }), { status: 400 });
    }

    // Build answers summary
    const seenCategories: string[] = [];
    for (const q of questions) {
      if (!seenCategories.includes(q.category)) seenCategories.push(q.category);
    }

    let answersSummary = "";
    for (const category of seenCategories) {
      const cqs = questions.filter((q) => q.category === category);
      if (cqs.length === 0) continue;
      answersSummary += `## ${category}\n\n`;
      for (const q of cqs) {
        const answer = answerMap.get(q.id);
        answersSummary += `**Q${q.globalOrder}: ${q.question}**\n`;
        answersSummary += answer ? `${answer}\n\n` : `_Not answered_\n\n`;
      }
    }

    const prompt = `You are an expert sales hiring consultant helping a founder define their ideal first (or next) Account Executive hire. Based on the founder's answers below, generate a comprehensive AE Hiring Profile report.

## QUESTIONNAIRE ANSWERS:

${answersSummary}

---

Generate a detailed AE Hiring Profile report in Markdown with these sections (use ## headings):

## Role Summary
2-3 paragraphs: the AE role, sales motion, target market, what makes this role unique.

## Ideal Background
Industries, company stages, deal sizes, selling experience that translates well. Be specific. Name 5-10 specific companies that are exemplars of each org type you recommend (e.g., "AEs from Gong, Outreach, or Salesloft who sold $30-80K ACV deals into VP Sales buyers").

## Must-Have Experience
Bullet list of non-negotiable experience/skills tied to the founder's sales motion.

## Nice-to-Have Experience
Bullet list of valuable but not required experience.

## Where to Look
Name 10-15 specific companies to source candidates from, organized by category (direct competitors, adjacent markets, similar sales motions, etc.). Include LinkedIn search criteria, communities, events, and sourcing channels. Be as concrete as possible — real company names, not generic descriptions.

## Red Flags
Backgrounds that look good but are bad fits. Explain WHY each is a red flag.

## Interview Focus Areas
Key areas to probe with suggested questions or evaluation criteria.

## Comp Expectations
Suggested OTE range and base/variable split with reasoning.

Be specific and actionable — avoid generic advice. Output ONLY the markdown report, no JSON wrapping.`;

    // Set up SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
          // Stream the profile content token by token
          const llmStream = await openai.chat.completions.create({
            model: "gpt-5.2",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            stream: true,
          });

          let fullContent = "";
          for await (const chunk of llmStream) {
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
              fullContent += token;
              send("token", { token });
            }
          }

          // Generate a title (fast, non-streaming)
          const titleRes = await openai.chat.completions.create({
            model: "gpt-5.2",
            messages: [{ role: "user", content: `Based on this AE hiring profile, generate a short title in the format "AE Hiring Profile - [brief descriptor]". Respond with ONLY the title.\n\n${fullContent.substring(0, 2000)}` }],
            temperature: 0.5,
          });
          const title = (titleRes.choices[0]?.message?.content || "AE Hiring Profile").trim();

          // Save to database
          const version = await prisma.hiringProfileVersion.create({
            data: {
              userId: user.id,
              title,
              content: fullContent,
            },
          });

          // Save answer snapshots
          const answerSnapshots = questions.map((q) => ({
            userId: user.id,
            questionId: q.id,
            versionId: version.id,
            answer: answerMap.get(q.id) || "",
          }));
          await prisma.hiringProfileAnswer.createMany({ data: answerSnapshots });

          send("complete", { versionId: version.id, title });
        } catch (error) {
          console.error("[hiring-profile-stream] Error:", error);
          send("error", { message: error instanceof Error ? error.message : "Generation failed" });
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
    console.error("[hiring-profile-stream] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start generation" }), { status: 500 });
  }
}
