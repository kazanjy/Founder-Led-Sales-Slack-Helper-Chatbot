import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { openai } from "@/lib/openai";
import { buildAccountContext, type Scope } from "@/lib/admin/account-context";

const SYSTEM_PROMPT = `You are answering an internal admin's question about a single Mikey account.
You have a structured context bundle of that account's data: GTM variables, maturity stage and assessments, sales readiness progression, coaching goals and tasks (with comments), recent coaching sessions (notes plus the most recent 5 transcripts), and the sales asset library.

Rules:
- Use ONLY the context provided. If the answer isn't in the context, say so plainly — don't speculate.
- Cite sources where helpful (e.g., "from the Apr 16 coaching session", "per the most recent maturity assessment").
- Be concise and direct. The reader is an admin trying to get a quick answer about a specific account.
- If the question implies a multi-step analysis, walk through the reasoning briefly before stating your conclusion.`;

export async function POST(request: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { scope?: string; targetId?: string; question?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scope = body.scope === "account" || body.scope === "user" ? (body.scope as Scope) : null;
  const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";

  if (!scope) {
    return NextResponse.json({ error: "scope must be 'account' or 'user'" }, { status: 400 });
  }
  if (!targetId) {
    return NextResponse.json({ error: "targetId is required" }, { status: 400 });
  }
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  if (question.length > 4_000) {
    return NextResponse.json({ error: "Question is too long (max 4000 chars)" }, { status: 400 });
  }

  let bundle;
  try {
    bundle = await buildAccountContext(scope, targetId);
  } catch (err) {
    console.error("[account-context/ask] context build failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build context" },
      { status: 400 }
    );
  }

  let answer: string;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Account context:\n\n${bundle.contextText}\n\n---\n\nQuestion: ${question}`,
        },
      ],
      max_completion_tokens: 4_000,
    });
    answer = response.choices[0]?.message?.content?.trim() || "(no answer)";
  } catch (err) {
    console.error("[account-context/ask] OpenAI call failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "LLM call failed" },
      { status: 502 }
    );
  }

  // Audit row — store question preview and bundle stats only. Never
  // the answer or the context bundle itself.
  try {
    await prisma.adminContextQuery.create({
      data: {
        adminUserId: admin.id,
        scope,
        targetId,
        questionPreview: question.slice(0, 200),
        itemCounts: JSON.stringify(bundle.stats),
        totalChars: bundle.stats.totalChars,
        truncations: bundle.truncations.length > 0 ? JSON.stringify(bundle.truncations) : null,
      },
    });
  } catch (err) {
    // Audit failure shouldn't fail the response, but log loudly.
    console.error("[account-context/ask] audit insert failed:", err);
  }

  return NextResponse.json({
    answer,
    stats: bundle.stats,
    truncations: bundle.truncations,
  });
}
