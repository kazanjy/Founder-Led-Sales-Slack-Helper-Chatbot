import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { extractProductName } from "@/lib/extract-product-name";
import { persistNarrativeSources, type ExtractedSource } from "@/lib/narrative-prefill/sources";

export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    let sourceUrls: string[] = [];
    let sourcePdfNames: string[] = [];
    let extractedSources: ExtractedSource[] = [];
    let parentVersionId: string | null = null;
    try {
      const body = await request.json();
      sourceUrls = body.sourceUrls || [];
      sourcePdfNames = body.sourcePdfNames || [];
      if (Array.isArray(body.extractedSources)) {
        extractedSources = body.extractedSources
          .filter((s: { type?: string; key?: string; content?: string }) =>
            (s.type === "url" || s.type === "pdf") && typeof s.key === "string" && typeof s.content === "string"
          )
          .map((s: { type: "url" | "pdf"; key: string; content: string }) => ({
            type: s.type,
            key: s.key,
            content: s.content,
          }));
      }
      // Extend flow: client passes parentVersionId so we inherit any
      // cached sources from the prior version that the client didn't
      // re-supply (typical for the original crawl text).
      if (typeof body.parentVersionId === "string") {
        parentVersionId = body.parentVersionId;
      }
    } catch {
      // optional
    }

    const questions = await prisma.salesNarrativeQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
    });

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

    if (latestAnswers.length === 0) {
      return new Response(JSON.stringify({ error: "No answers found" }), { status: 400 });
    }

    // Build answers summary
    const categoryOrder = ["Product", "Problem", "Solution", "Proof", "Business"];
    let answersSummary = "";
    const productQuestion = questions.find((q) => q.category === "Product");
    const productName = productQuestion
      ? extractProductName(answerMap.get(productQuestion.id) || "", "the product")
      : "the product";

    for (const category of categoryOrder) {
      const categoryQuestions = questions.filter((q) => q.category === category);
      if (categoryQuestions.length === 0) continue;
      answersSummary += `## ${category}\n\n`;
      for (const q of categoryQuestions) {
        const answer = answerMap.get(q.id);
        answersSummary += `**Q${q.globalOrder}: ${q.question}**\n`;
        answersSummary += answer ? `${answer}\n\n` : `_Not answered_\n\n`;
      }
    }

    const sharedPreamble = `You are helping a founder create their sales narrative.
The product/service name is: ${productName}
IMPORTANT: Do NOT mention "Pete Kazanjy" or "Founding Sales" anywhere in the generated text.

## QUESTIONNAIRE ANSWERS:

${answersSummary}`;

    const narrativePrompt = `${sharedPreamble}

---

Write a compelling sales narrative (~2000 words) as flowing prose with exactly 8 sections. Each section MUST start with its bold header on its own line:

**What's the problem?**
(2-4 paragraphs)

**Who has the problem?**
(2-4 paragraphs)

**What's the cost of not solving the problem?**
(2-4 paragraphs)

**How is this currently solved? Why doesn't that work?**
(2-4 paragraphs)

**What has changed?**
(2-4 paragraphs)

**How does it work?**
(2-4 paragraphs)

**How do you know it's better?**
(2-4 paragraphs)

**Pricing**
(2-4 paragraphs)

Use an engaging, conversational tone with urgency. Include specific numbers and metrics. Write approximately 2000 words total.

Output ONLY the narrative text (with bold headers). No JSON, no code blocks.`;

    const condensedPrompt = `${sharedPreamble}

---

Write a condensed ~1000-word version of a sales narrative with the same 8 bold section headers:
**What's the problem?**, **Who has the problem?**, **What's the cost of not solving the problem?**, **How is this currently solved? Why doesn't that work?**, **What has changed?**, **How does it work?**, **How do you know it's better?**, **Pricing**

Each section should be 1-2 paragraphs. Engaging tone, specific metrics.

Output ONLY the narrative text (with bold headers). No JSON, no code blocks.`;

    const descriptionsPrompt = `${sharedPreamble}

---

Generate three product descriptions. Be specific about problem, solution, differentiation.

Respond ONLY with valid JSON (no markdown code blocks):
{"description100w": "A ~100-word product marketing summary...", "description50w": "A ~50-word elevator pitch...", "description25w": "A ~25-word tagline..."}`;

    const titlePrompt = `Based on the following product/company information, generate a short descriptive title in the format: "[Product Name] - [Category/Market] - Sales Narrative". For example: "TalentBin - Technical Recruiting - Sales Narrative" or "Salesforce - B2B CRM - Sales Narrative". The title should make it immediately clear what product and market the narrative is about. Respond with ONLY the title text, nothing else.

Product name: ${productName}

Context:
${answersSummary.substring(0, 2000)}`;

    // Set up SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
          // Fire all LLM calls in parallel
          // Narrative streams; others are awaited for complete results
          const narrativeStream = await openai.chat.completions.create({
            model: "gpt-5.5",
            messages: [{ role: "user", content: narrativePrompt }],
            stream: true,
          });

          const condensedPromise = openai.chat.completions.create({
            model: "gpt-5.5",
            messages: [{ role: "user", content: condensedPrompt }],
          });

          const descriptionsPromise = openai.chat.completions.create({
            model: "gpt-5.5",
            messages: [{ role: "user", content: descriptionsPrompt }],
          });

          const titlePromise = openai.chat.completions.create({
            model: "gpt-5.5",
            messages: [{ role: "user", content: titlePrompt }],
          });

          // Stream the narrative tokens
          let fullNarrative = "";
          for await (const chunk of narrativeStream) {
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
              fullNarrative += token;
              send("narrative_token", { token });
            }
          }
          send("narrative_done", { narrative: fullNarrative });

          // Await the other calls (they've been running in parallel)
          const [condensedRes, descriptionsRes, titleRes] = await Promise.all([
            condensedPromise,
            descriptionsPromise,
            titlePromise,
          ]);

          const description1000w = condensedRes.choices[0]?.message?.content || "";
          send("condensed_done", { description1000w });

          let description100w = "";
          let description50w = "";
          let description25w = "";
          try {
            const descRaw = descriptionsRes.choices[0]?.message?.content || "";
            const descJson = descRaw.match(/\{[\s\S]*\}/);
            if (descJson) {
              const parsed = JSON.parse(descJson[0]);
              description100w = parsed.description100w || "";
              description50w = parsed.description50w || "";
              description25w = parsed.description25w || "";
            }
          } catch {
            console.error("[generate-stream] Failed to parse descriptions");
          }
          send("descriptions_done", { description100w, description50w, description25w });

          const narrativeTitle = (titleRes.choices[0]?.message?.content || "").trim()
            || `${productName} - Sales Narrative`;

          // Save to database
          const version = await prisma.salesNarrativeVersion.create({
            data: {
              userId: user.id,
              title: narrativeTitle,
              narrative: fullNarrative,
              description1000w: description1000w || null,
              description100w,
              description50w,
              description25w,
              sourceUrls,
              sourcePdfNames,
            },
          });

          // Persist source text into the NarrativeSource cache so the
          // Extend flow can reuse the original tokens without
          // re-crawling. Inherits parent-version sources (deduped by
          // key) for any the client didn't re-supply.
          try {
            const inherited: ExtractedSource[] = [];
            if (parentVersionId) {
              const { loadNarrativeSources } = await import("@/lib/narrative-prefill/sources");
              const prior = await loadNarrativeSources({ userId: user.id, versionId: parentVersionId });
              const seen = new Set(extractedSources.map((s) => `${s.type}:${s.key.toLowerCase()}`));
              for (const p of prior) {
                if (!seen.has(`${p.type}:${p.key.toLowerCase()}`)) inherited.push(p);
              }
            }
            await persistNarrativeSources({
              userId: user.id,
              versionId: version.id,
              sources: [...extractedSources, ...inherited],
            });
          } catch (sourceErr) {
            console.error(`[generate-stream] persistNarrativeSources failed for ${version.id}:`, sourceErr);
          }

          // Save answer snapshots and merge variables in parallel
          const answerSnapshots = questions.map((q) => ({
            userId: user.id,
            questionId: q.id,
            versionId: version.id,
            answer: answerMap.get(q.id) || "",
          }));

          const mergeVariables = [
            { mergeField: "SALES_NARRATIVE", name: "Sales Narrative", value: fullNarrative },
            { mergeField: "VALUE_PROP_1000W", name: "Value Proposition (1000 words)", value: description1000w },
            { mergeField: "VALUE_PROP_100W", name: "Value Proposition (100 words)", value: description100w },
            { mergeField: "VALUE_PROP_50W", name: "Value Proposition (50 words)", value: description50w },
            { mergeField: "VALUE_PROP_25W", name: "Value Proposition (25 words)", value: description25w },
          ];

          await Promise.all([
            prisma.salesNarrativeAnswer.createMany({ data: answerSnapshots }),
            ...mergeVariables.map((mv) =>
              prisma.gtmVariable.upsert({
                where: { userId_mergeField: { userId: user.id, mergeField: mv.mergeField } },
                update: { value: mv.value },
                create: { userId: user.id, mergeField: mv.mergeField, name: mv.name, value: mv.value, isDefault: false },
              })
            ),
          ]);

          // Create linked chat conversation
          try {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";
            const narrativeUrl = `${appUrl}/sales-narrative?version=${version.id}`;
            await prisma.conversation.create({
              data: {
                userId: user.id,
                source: "WEB",
                title: `Sales Narrative: ${narrativeTitle}`,
                firstMessagePreview: "Generate my Sales Narrative",
                messageCount: 2,
                lastMessageAt: new Date(),
                messages: {
                  create: [
                    { userId: user.id, role: "USER", content: "Generate my Sales Narrative" },
                    { role: "ASSISTANT", content: `[View your Sales Narrative](${narrativeUrl})\n\n**${narrativeTitle}**\n\n${fullNarrative.substring(0, 500)}${fullNarrative.length > 500 ? "..." : ""}` },
                  ],
                },
              },
            });
          } catch (e) { console.error("[generate-stream] conversation error:", e); }

          send("complete", {
            versionId: version.id,
            title: narrativeTitle,
          });
        } catch (error) {
          console.error("[generate-stream] Error:", error);
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
    console.error("[generate-stream] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start generation" }), { status: 500 });
  }
}
