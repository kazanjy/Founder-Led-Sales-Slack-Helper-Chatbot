import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

// POST — analyze source material and propose readiness item updates
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!user.accountId) {
      return NextResponse.json({ error: "No account found" }, { status: 400 });
    }

    const body = await request.json();
    const { source } = body as { source: "assessment" | "coaching" };

    if (!source || !["assessment", "coaching"].includes(source)) {
      return NextResponse.json({ error: "Invalid source. Must be 'assessment' or 'coaching'." }, { status: 400 });
    }

    // ── 1. Collect source material ──────────────────────────
    let sourceText = "";
    let sourceLabel = "";

    if (source === "assessment") {
      sourceText = await collectAssessmentTokens(user.id);
      sourceLabel = "GTM Maturity Assessment answers";
    } else {
      sourceText = await collectCoachingTokens(user.id);
      sourceLabel = "Coaching session notes, goals, and tasks";
    }

    if (!sourceText.trim()) {
      return NextResponse.json({
        error: source === "assessment"
          ? "No completed assessment found. Complete a GTM Maturity Assessment first."
          : "No coaching sessions found. Log a coaching session first.",
      }, { status: 400 });
    }

    // ── 2. Fetch all readiness items with current status ────
    const items = await prisma.salesReadinessItem.findMany({
      orderBy: [{ maturityStage: "asc" }, { capabilityCategory: "asc" }, { order: "asc" }],
    });

    const accountItems = await prisma.salesReadinessAccountItem.findMany({
      where: { accountId: user.accountId },
    });
    const progressMap = new Map(accountItems.map((ai) => [ai.itemId, ai]));

    // Build items context for AI
    const itemsContext = items.map((item) => {
      const progress = progressMap.get(item.id);
      return {
        id: item.id,
        maturityStage: item.maturityStage,
        capabilityCategory: item.capabilityCategory,
        title: item.title,
        description: item.description || "",
        currentStatus: progress?.status || "to_do",
        currentNotes: progress?.notes || "",
        currentEvidence: progress?.evidenceUrl || "",
      };
    });

    // Only include items eligible for sync (not up_next, not_doing, deferred)
    const eligibleItems = itemsContext.filter(
      (i) => !["up_next", "not_doing", "deferred"].includes(i.currentStatus)
    );

    // ── 3. Call GPT-5 for matching ──────────────────────────
    const systemPrompt = `You are an expert GTM (go-to-market) analyst. You are analyzing a founder's ${sourceLabel} to determine which sales readiness capabilities they have evidence for.

Your job is to match evidence from the source material to specific readiness capability items, and propose status changes and evidence text.

RULES:
- Only propose changes where the source material provides CLEAR evidence
- For status, only propose: "to_do", "in_progress", or "done"
  - "done" = the founder clearly has this capability/asset built and working
  - "in_progress" = the founder has started but not completed this capability
  - "to_do" = leave unchanged (only include if you want to add evidence/notes to a to_do item)
- Do NOT propose changes for items already marked "done" unless you have new evidence to add
- Be conservative with "done" — only mark done when evidence is strong
- For evidenceText, write a concise 1-2 sentence summary of what the founder has, referencing specific details from their answers
- For supportingExcerpts, include the actual relevant quotes/excerpts from the source material
- Also recommend the best-fit maturity stage based on the overall picture

MATURITY STAGE DEFINITIONS (use these to determine the best-fit stage):

1) PROBLEM_VALIDATION — "Do we know what problem we're solving?"
   Entry: Hypothesis exists for target persona(s), pain, and why now. Can name 50–200 target accounts.
   Exit: 20–40+ structured customer interviews completed (users + buyers), synthesized into top pains + current workflows. Clear "who has the problem" + "cost of problem" bullets. Minimum viable feature list / MVP scope agreed.

2) VALUE_VALIDATION — "Does it solve it and create value?"
   Entry: MVP exists enough to show/deliver a wedge.
   Exit: 3–5+ design partners using it in real workflow. Documented proof points with at least one quantified KPI (hours saved, reduced data spend, turnaround time). Crisp sales narrative + ICP v1 written. Implementation path is known.

3) FIRST_REVENUE — "Can we get someone to pay?"
   Entry: Pricing hypothesis + packaging exists. A basic discovery → demo → pricing → next steps flow.
   Exit: 1–3 paying customers (not pilot-for-free), still believing they get value after onboarding. Can articulate top 3 closed-lost reasons. Baseline funnel metrics exist (meetings held, opps created, wins).

4) REPEATABLE_REVENUE — "Can we get many people to pay?"
   Entry: Can close deals founder-led with some consistency.
   Exit: 30–50+ non-friendly prospects run through the process. 10–20 customers closed/won, onboarded, and reaching value. Repeatable lead source(s) identified + tracked in CRM. Basic CS motions exist (kickoff, time-to-value target, renewal owner).

5) FIRST_SALES_HIRE — "Can a non-founder sell this?"
   Entry: Repeatable revenue signals + stable-ish ICP and pitch.
   Exit: Sales playbook v1 exists (ICP, discovery questions, demo script, pricing/ROI, objection handling, stages + exit criteria). First AE/SDR ramps to first meetings and at least 1–2 closes with founder support. Call recording + review cadence in place.

6) SCALING_SALES — "Can many non-founders sell this?"
   Entry: First hire can close; motion is teachable.
   Exit: Multiple reps consistently hit activity + pipeline creation targets; forecasting becomes meaningful. Sales stages enforced with clear entry/exit criteria in CRM. Repeatable hiring + onboarding (curriculum, certification), plus manager rhythm (1:1s, pipeline reviews).

Return valid JSON with this exact structure:
{
  "proposedChanges": [
    {
      "itemId": "the item ID",
      "proposedStatus": "done" | "in_progress" | "to_do",
      "confidence": "high" | "medium" | "low",
      "evidenceText": "concise evidence summary",
      "supportingExcerpts": [
        {
          "source": "descriptive label of where this came from",
          "text": "the relevant excerpt"
        }
      ],
      "reasoning": "brief explanation of why this status"
    }
  ],
  "recommendedStage": {
    "stage": "PROBLEM_VALIDATION" | "VALUE_VALIDATION" | "FIRST_REVENUE" | "REPEATABLE_REVENUE" | "FIRST_SALES_HIRE" | "SCALING_SALES",
    "reasoning": "brief explanation"
  }
}

Only include items where you have evidence. Do NOT include items where you have nothing to say.`;

    const userPrompt = `## Source Material (${sourceLabel})

${sourceText}

## Readiness Capability Items to Evaluate

${eligibleItems.map((i) => `- ID: ${i.id} | Stage: ${i.maturityStage} | Category: ${i.capabilityCategory} | Title: ${i.title}${i.description ? ` | Description: ${i.description}` : ""} | Current Status: ${i.currentStatus}`).join("\n")}`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    const result = JSON.parse(content);

    // Enrich proposed changes with display info
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const enrichedChanges = (result.proposedChanges || []).map((change: {
      itemId: string;
      proposedStatus: string;
      confidence: string;
      evidenceText: string;
      supportingExcerpts: Array<{ source: string; text: string }>;
      reasoning: string;
    }) => {
      const item = itemMap.get(change.itemId);
      const progress = progressMap.get(change.itemId);
      return {
        ...change,
        itemTitle: item?.title || "Unknown",
        capabilityCategory: item?.capabilityCategory || "Unknown",
        maturityStage: item?.maturityStage || "Unknown",
        currentStatus: progress?.status || "to_do",
      };
    });

    return NextResponse.json({
      source,
      proposedChanges: enrichedChanges,
      recommendedStage: result.recommendedStage || null,
      totalItemsAnalyzed: eligibleItems.length,
      sourceContent: sourceText,
    });
  } catch (error) {
    console.error("Error in readiness sync:", error);
    return NextResponse.json({ error: "Failed to analyze and sync" }, { status: 500 });
  }
}

// ── Source Collectors ──────────────────────────────────────

async function collectAssessmentTokens(userId: string): Promise<string> {
  // Get the latest completed assessment
  const latestAssessment = await prisma.maturityAssessment.findFirst({
    where: { userId },
    orderBy: { completedAt: "desc" },
    include: {
      answers: {
        include: {
          question: true,
        },
      },
    },
  });

  if (!latestAssessment || latestAssessment.answers.length === 0) {
    // Fall back to latest answers without an assessment
    const questions = await prisma.maturityQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
    });

    const answers = await Promise.all(
      questions.map(async (q) => {
        const answer = await prisma.maturityAnswer.findFirst({
          where: { userId, questionId: q.id },
          orderBy: { createdAt: "desc" },
        });
        return { question: q, answer };
      })
    );

    const answeredPairs = answers.filter((a) => a.answer);
    if (answeredPairs.length === 0) return "";

    return answeredPairs
      .map((a) => `Q${a.question.globalOrder} (${a.question.category}): ${a.question.question}\nA: ${a.answer!.answer}`)
      .join("\n\n");
  }

  // Use assessment answers
  return latestAssessment.answers
    .sort((a, b) => (a.question.globalOrder ?? 0) - (b.question.globalOrder ?? 0))
    .map((a) => `Q${a.question.globalOrder} (${a.question.category}): ${a.question.question}\nA: ${a.answer}`)
    .join("\n\n");
}

async function collectCoachingTokens(userId: string): Promise<string> {
  // Get all coaching sessions with goals and tasks
  const sessions = await prisma.coachingSession.findMany({
    where: { userId },
    orderBy: { sessionDate: "desc" },
    include: {
      goals: {
        include: { tasks: true },
      },
    },
  });

  if (sessions.length === 0) return "";

  const parts: string[] = [];

  for (const session of sessions) {
    const sessionDate = session.sessionDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    let sessionText = `=== Coaching Session: ${session.title} (${sessionDate}) ===\n`;

    if (session.notes) {
      sessionText += `Notes:\n${session.notes}\n`;
    }

    if (session.goals.length > 0) {
      sessionText += `\nGoals:\n`;
      for (const goal of session.goals) {
        sessionText += `- [${goal.status.toUpperCase()}] ${goal.title}`;
        if (goal.description) sessionText += `: ${goal.description}`;
        sessionText += "\n";

        for (const task of goal.tasks) {
          sessionText += `  - [${task.status.toUpperCase()}] ${task.title}`;
          if (task.description) sessionText += `: ${task.description}`;
          sessionText += "\n";
        }
      }
    }

    if (session.transcript) {
      // Truncate transcript to avoid token overflow
      const truncated = session.transcript.length > 3000
        ? session.transcript.substring(0, 3000) + "...[truncated]"
        : session.transcript;
      sessionText += `\nTranscript excerpt:\n${truncated}\n`;
    }

    parts.push(sessionText);
  }

  return parts.join("\n\n");
}
