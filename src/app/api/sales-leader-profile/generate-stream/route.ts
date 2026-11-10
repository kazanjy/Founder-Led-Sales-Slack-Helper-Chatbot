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

    const questions = await prisma.salesLeaderProfileQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
    });

    const latestAnswers = await prisma.$queryRaw<
      Array<{ questionId: string; answer: string; createdAt: Date }>
    >`
      SELECT DISTINCT ON ("questionId") "questionId", "answer", "createdAt"
      FROM "sales_leader_profile_answers"
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

    const prompt = `You are an expert sales hiring consultant helping a founder define their ideal Sales Leader / VP Sales / Head of Sales hire. Based on the founder's answers below, generate a comprehensive Sales Leader Hiring Profile report.

## QUESTIONNAIRE ANSWERS:

${answersSummary}

---

Generate a detailed Sales Leader Hiring Profile report in Markdown with these sections (use ## headings):

## Role Summary
2-3 paragraphs: the sales leader role, what kind of leader is needed, what team they will manage, at what company stage, the GTM motion, and what makes this role unique.

## Ideal Background
Companies they've worked at, team sizes they've managed, GTM stages they've navigated, revenue milestones they've hit. Be specific about the type of leadership experience that translates well. Name 5-10 specific companies that are exemplars of each org type you recommend (e.g., "Leaders who built the sales org at Gong from $5M-$50M ARR" or "VP Sales at Datadog, MongoDB, or HubSpot during their Series B-C phase").

## Must-Have Experience
Bullet list of non-negotiable experience/skills tied to the founder's sales motion and company stage (e.g., built a team from scratch, managed X reps, sold into specific market segments).

## Nice-to-Have Experience
Bullet list of valuable but not required experience.

## Where to Look
Name 10-15 specific companies to source candidates from, organized by category (similar stage/motion, adjacent markets, known for developing strong sales leaders, etc.). Include LinkedIn search criteria, communities, events, and sourcing channels. Be as concrete as possible — real company names, not generic descriptions.

## Red Flags
Backgrounds that look good on paper but are bad fits for this stage/motion. Explain WHY each is a red flag (e.g., "led 50-person team at enterprise co" may signal wrong stage fit).

## Interview Focus Areas
Key areas to probe with suggested questions or evaluation criteria — focus on leadership style, team building, founder-leader dynamic, and strategic thinking.

## Comp Expectations
Suggested base, OTE, and equity ranges for a sales leader at this stage, with reasoning about market rates and what levers matter most.

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
            model: "gpt-5.5",
            messages: [{ role: "user", content: prompt }],
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
            model: "gpt-5.5",
            messages: [{ role: "user", content: `Based on this Sales Leader hiring profile, generate a short title in the format "Sales Leader Hiring Profile - [brief descriptor]". Respond with ONLY the title.\n\n${fullContent.substring(0, 2000)}` }],
          });
          const title = (titleRes.choices[0]?.message?.content || "Sales Leader Hiring Profile").trim();

          // Save to database
          const version = await prisma.salesLeaderProfileVersion.create({
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
          await prisma.salesLeaderProfileAnswer.createMany({ data: answerSnapshots });

          send("complete", { versionId: version.id, title });
        } catch (error) {
          console.error("[sales-leader-profile-stream] Error:", error);
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
    console.error("[sales-leader-profile-stream] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start generation" }), { status: 500 });
  }
}
