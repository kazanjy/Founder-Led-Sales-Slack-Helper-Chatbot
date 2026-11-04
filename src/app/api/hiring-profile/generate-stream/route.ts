import { prisma } from "@/lib/db";
import { parseHiringRole, ROLE_META } from "@/lib/hiring/role-types";
import { buildHiringProfilePrompt, buildTitlePrompt } from "@/lib/hiring/profile-prompts";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    let guidance = "";
    let roleType = parseHiringRole(null);
    try {
      const body = await request.json();
      guidance = body?.guidance || "";
      roleType = parseHiringRole(body?.roleType);
    } catch { /* no body is fine */ }

    const questions = await prisma.hiringProfileQuestion.findMany({
      where: { enabled: true, roleType },
      orderBy: { globalOrder: "asc" },
    });
    if (questions.length === 0) {
      return new Response(
        JSON.stringify({
          error: `No ${roleType} questions are seeded yet. Run scripts/seed-role-hiring-profile-questions.ts.`,
        }),
        { status: 400 }
      );
    }

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

    // Fetch additional context: Sales Narrative, GTM Assessment, GTM Readiness
    let additionalContext = "";

    // Sales Narrative
    try {
      const narrativeVersion = await prisma.salesNarrativeVersion.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: { narrative: true },
      });
      if (narrativeVersion?.narrative) {
        additionalContext += "\n\n---\n\n## SALES NARRATIVE (for additional context)\n\n" +
          narrativeVersion.narrative.substring(0, 3000);
      }
    } catch { /* ignore */ }

    // GTM Assessment answers
    try {
      const maturityQuestions = await prisma.maturityQuestion.findMany({
        where: { enabled: true },
        orderBy: { globalOrder: "asc" },
        select: { id: true, category: true, globalOrder: true, question: true },
      });
      const maturityAnswers = await prisma.$queryRaw<
        Array<{ questionId: string; answer: string }>
      >`
        SELECT DISTINCT ON ("questionId") "questionId", "answer"
        FROM "maturity_answers"
        WHERE "userId" = ${user.id}
        ORDER BY "questionId", "createdAt" DESC
      `;
      const maturityMap = new Map(maturityAnswers.map((a: { questionId: string; answer: string }) => [a.questionId, a.answer]));
      const answeredMaturity = maturityQuestions.filter((q) => maturityMap.has(q.id));
      if (answeredMaturity.length > 0) {
        additionalContext += "\n\n---\n\n## GTM ASSESSMENT ANSWERS (for additional context)\n\n";
        for (const q of answeredMaturity) {
          additionalContext += `**Q${q.globalOrder} [${q.category}]: ${q.question}**\n${maturityMap.get(q.id)}\n\n`;
        }
      }
    } catch { /* ignore */ }

    // GTM Readiness Progression
    if (user.accountId) {
      try {
        const readinessItems = await prisma.salesReadinessItem.findMany({
          orderBy: [{ maturityStage: "asc" }, { capabilityCategory: "asc" }, { order: "asc" }],
        });
        const accountItems = await prisma.salesReadinessAccountItem.findMany({
          where: { accountId: user.accountId },
        });
        const progressMap = new Map(accountItems.map((ai: { itemId: string; status: string; notes: string | null; evidenceUrl: string | null }) => [ai.itemId, ai]));
        const nonTodoItems = readinessItems.filter((item: { id: string }) => {
          const progress = progressMap.get(item.id);
          return progress && progress.status !== "to_do";
        });
        if (nonTodoItems.length > 0) {
          additionalContext += "\n\n---\n\n## GTM READINESS PROGRESSION (for additional context)\n\n";
          for (const item of nonTodoItems) {
            const progress = progressMap.get(item.id);
            if (!progress) continue;
            additionalContext += `- [${progress.status.toUpperCase()}] ${(item as { maturityStage: string }).maturityStage} > ${(item as { capabilityCategory: string }).capabilityCategory} > ${(item as { title: string }).title}`;
            if (progress.evidenceUrl) additionalContext += ` — Evidence: ${progress.evidenceUrl}`;
            additionalContext += "\n";
          }
        }
      } catch { /* ignore */ }
    }

    // Coaching Sessions (goals, tasks, notes — no transcripts)
    try {
      const coachingSessions = await prisma.coachingSession.findMany({
        where: { userId: user.id },
        orderBy: { sessionDate: "desc" },
        include: {
          goals: { include: { tasks: true } },
        },
      });
      if (coachingSessions.length > 0) {
        additionalContext += "\n\n---\n\n## COACHING SESSIONS (for additional context)\n\n";
        for (const session of coachingSessions) {
          const sessionDate = session.sessionDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          additionalContext += `### ${session.title} (${sessionDate})\n`;
          if (session.notes) {
            additionalContext += session.notes.substring(0, 1500) + "\n";
          }
          if (session.goals.length > 0) {
            additionalContext += "Goals:\n";
            for (const goal of session.goals) {
              additionalContext += `- [${goal.status.toUpperCase()}] ${goal.title}`;
              if (goal.description) additionalContext += `: ${goal.description}`;
              additionalContext += "\n";
              for (const task of goal.tasks) {
                additionalContext += `  - [${task.status.toUpperCase()}] ${task.title}\n`;
              }
            }
          }
          additionalContext += "\n";
        }
      }
    } catch { /* ignore */ }

    const prompt = buildHiringProfilePrompt(roleType, answersSummary, additionalContext, guidance);

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
            messages: [{ role: "user", content: buildTitlePrompt(roleType, fullContent) }],
          });
          const title = (titleRes.choices[0]?.message?.content || ROLE_META[roleType].profileTitle).trim();

          // Save to database
          const version = await prisma.hiringProfileVersion.create({
            data: {
              userId: user.id,
              roleType,
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
