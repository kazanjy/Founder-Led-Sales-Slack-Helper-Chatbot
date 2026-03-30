import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    const { collectionId } = await request.json();

    if (!collectionId) {
      return new Response(JSON.stringify({ error: "collectionId is required" }), { status: 400 });
    }

    const collection = await prisma.salesMotionCollection.findFirst({
      where: { id: collectionId, userId: user.id },
      include: {
        deals: {
          include: { calls: { orderBy: { callOrder: "asc" } } },
          orderBy: { dealOrder: "asc" },
        },
      },
    });

    if (!collection) {
      return new Response(JSON.stringify({ error: "Collection not found" }), { status: 404 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
          // Mark collection as processing
          await prisma.salesMotionCollection.update({
            where: { id: collectionId },
            data: { status: "processing" },
          });

          // ================================================================
          // PASS 1: Name & Classify (parallel per deal)
          // ================================================================
          const classifyResults = await Promise.all(
            collection.deals.map(async (deal) => {
              const callSummaries = deal.calls
                .map(
                  (c, i) =>
                    `Call ${i + 1} (ID: ${c.id}, order: ${c.callOrder}):\n${c.summary || "(no summary)"}`
                )
                .join("\n\n---\n\n");

              const classifyPrompt = `You are a sales process analyst. Given the following call summaries from a single deal, generate:
1. A short descriptive deal name (e.g., "Acme Corp - Enterprise Deal")
2. For each call, a short name (e.g., "Initial Discovery Call") and a type classification.

Valid call types: "discovery", "demo", "proposal", "negotiation", "security", "technical", "closing", "other"

## CALL SUMMARIES:

${callSummaries}

Respond with JSON only, no markdown fencing:
{
  "dealName": "...",
  "calls": [
    { "callId": "...", "callName": "...", "callType": "..." }
  ]
}`;

              const res = await openai.chat.completions.create({
                model: "gpt-5.2",
                messages: [{ role: "user", content: classifyPrompt }],
                temperature: 0.7,
              });

              const raw = res.choices[0]?.message?.content || "{}";
              // Strip markdown fencing if present
              const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
              const parsed = JSON.parse(cleaned) as {
                dealName: string;
                calls: Array<{ callId: string; callName: string; callType: string }>;
              };

              // Update deal name
              await prisma.salesMotionDeal.update({
                where: { id: deal.id },
                data: { name: parsed.dealName },
              });

              // Update each call
              await Promise.all(
                parsed.calls.map((c) =>
                  prisma.salesMotionCall.update({
                    where: { id: c.callId },
                    data: { name: c.callName, callType: c.callType },
                  })
                )
              );

              return {
                id: deal.id,
                name: parsed.dealName,
                calls: parsed.calls.map((c) => ({
                  id: c.callId,
                  name: c.callName,
                  callType: c.callType,
                })),
              };
            })
          );

          send("classify_done", { deals: classifyResults });

          // Reload collection with updated names/types for subsequent passes
          const updatedCollection = await prisma.salesMotionCollection.findFirst({
            where: { id: collectionId },
            include: {
              deals: {
                include: { calls: { orderBy: { callOrder: "asc" } } },
                orderBy: { dealOrder: "asc" },
              },
            },
          });

          if (!updatedCollection) throw new Error("Collection disappeared");

          // ================================================================
          // PASS 2: Synthesize Sales Motion (streaming)
          // ================================================================
          const dealSequences = updatedCollection.deals
            .map((deal) => {
              const callList = deal.calls
                .map(
                  (c) =>
                    `- ${c.name || "Unnamed"} [${c.callType || "other"}]: ${(c.summary || "").substring(0, 500)}`
                )
                .join("\n");
              return `### ${deal.name || "Unnamed Deal"} (${deal.outcome || "unknown outcome"})\n${callList}`;
            })
            .join("\n\n");

          const motionPrompt = `You are an expert B2B sales strategist. Analyze the following set of deals and their call sequences to synthesize the founder's sales motion.

## DEALS AND CALL SEQUENCES:

${dealSequences}

---

Generate a comprehensive Sales Motion Synthesis in Markdown with these sections (use ## headings):

## Typical Deal Stages & Progression
Describe the stages a deal goes through from first contact to close, based on the patterns you see.

## Stage Durations
Estimate typical time spent in each stage based on the call sequences.

## Key Activities Per Stage
What happens in each stage — key conversations, deliverables, actions.

## Decision Points
Critical moments where deals advance or stall. What triggers progression?

## Stakeholder Involvement Patterns
Who gets involved when? How does the buying committee evolve through the deal?

## Common Patterns Across Winning Deals
What do successful deals have in common? Patterns in sequencing, timing, engagement.

Be specific and grounded in the data provided. Output ONLY the markdown report.`;

          const motionStream = await openai.chat.completions.create({
            model: "gpt-5.2",
            messages: [{ role: "user", content: motionPrompt }],
            temperature: 0.7,
            stream: true,
          });

          let motionContent = "";
          for await (const chunk of motionStream) {
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
              motionContent += token;
              send("motion_token", { token });
            }
          }

          // Save synthesis to collection
          await prisma.salesMotionCollection.update({
            where: { id: collectionId },
            data: { salesMotionSynthesis: motionContent },
          });

          // Upsert SALES_MOTION GTM variable
          await prisma.gtmVariable.upsert({
            where: { userId_mergeField: { userId: user.id, mergeField: "SALES_MOTION" } },
            create: {
              userId: user.id,
              name: "Sales Motion",
              mergeField: "SALES_MOTION",
              description: "Synthesized sales motion analysis from call recordings",
              value: motionContent,
            },
            update: {
              value: motionContent,
            },
          });

          send("motion_done", {});

          // ================================================================
          // PASS 3: Synthesize Call Scripts (parallel per call type)
          // ================================================================
          // Group all calls by callType across all deals
          const callsByType: Record<
            string,
            Array<{ id: string; name: string | null; summary: string | null; transcript: string | null; dealName: string | null }>
          > = {};

          for (const deal of updatedCollection.deals) {
            for (const call of deal.calls) {
              const ct = call.callType || "other";
              if (!callsByType[ct]) callsByType[ct] = [];
              callsByType[ct].push({
                id: call.id,
                name: call.name,
                summary: call.summary,
                transcript: call.transcript,
                dealName: deal.name,
              });
            }
          }

          // Only synthesize types with 2+ calls
          const typesToSynthesize = Object.entries(callsByType).filter(
            ([, calls]) => calls.length >= 2
          );

          // Delete existing scripts for this collection before creating new ones
          await prisma.salesMotionCallScript.deleteMany({
            where: { collectionId },
          });

          await Promise.all(
            typesToSynthesize.map(async ([callType, calls]) => {
              const callContext = calls
                .map((c, i) => {
                  const transcriptSnippet = c.transcript
                    ? `\n\nTranscript (truncated):\n${c.transcript.substring(0, 30000)}`
                    : "";
                  return `### Example ${i + 1}: ${c.name || "Unnamed"} (Deal: ${c.dealName || "Unknown"})\n\nSummary:\n${c.summary || "(no summary)"}${transcriptSnippet}`;
                })
                .join("\n\n---\n\n");

              const scriptPrompt = `You are an expert B2B sales coach. Analyze the following ${calls.length} examples of "${callType}" calls and synthesize a canonical call script/playbook.

## EXAMPLE CALLS:

${callContext}

---

Generate a comprehensive Call Script / Playbook for "${callType}" calls in Markdown. Include:

## Call Overview
Purpose, typical duration, where this fits in the sales process.

## Pre-Call Preparation
What the rep should prepare/research before the call.

## Agenda / Structure
The typical flow of the call with time allocations.

## Key Questions to Ask
The most effective questions drawn from patterns across examples.

## Content / Talking Points
Key messages, value propositions, and discussion areas that appear consistently.

## Common Objections & Responses
Objections that come up and how they're handled.

## Call Outcomes & Next Steps
What a successful call looks like and typical follow-up actions.

Be specific and grounded in the actual examples provided. Output ONLY the markdown.`;

              const res = await openai.chat.completions.create({
                model: "gpt-5.2",
                messages: [{ role: "user", content: scriptPrompt }],
                temperature: 0.7,
              });

              const content = res.choices[0]?.message?.content || "";

              // Generate a title
              const callTypeTitle =
                callType.charAt(0).toUpperCase() + callType.slice(1) + " Call Playbook";

              const script = await prisma.salesMotionCallScript.create({
                data: {
                  collectionId,
                  callType,
                  title: callTypeTitle,
                  content,
                  sourceCallCount: calls.length,
                },
              });

              send("script_done", {
                id: script.id,
                callType,
                title: callTypeTitle,
                content,
                sourceCallCount: calls.length,
              });
            })
          );

          // ================================================================
          // COMPLETE
          // ================================================================
          await prisma.salesMotionCollection.update({
            where: { id: collectionId },
            data: { status: "complete" },
          });

          // Create a linked chat conversation
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";
          const motionUrl = `${appUrl}/sales-motion?collectionId=${collectionId}`;
          const dealCount = collection.deals.length;
          const userMessage = `Analyze my sales motion from ${dealCount} deal${dealCount !== 1 ? "s" : ""}`;
          const motionPreview = motionContent.substring(0, 500) + (motionContent.length > 500 ? "..." : "");
          const assistantContent = `[View full Sales Motion Analysis](${motionUrl})\n\n${motionPreview}`;

          try {
            await prisma.conversation.create({
              data: {
                userId: user.id,
                source: "WEB",
                title: `Sales Motion Analysis (${dealCount} deals)`,
                firstMessagePreview: userMessage.substring(0, 100),
                messageCount: 2,
                lastMessageAt: new Date(),
                messages: {
                  create: [
                    { userId: user.id, role: "USER", content: userMessage },
                    { role: "ASSISTANT", content: assistantContent },
                  ],
                },
              },
            });
          } catch (e) {
            console.error("[sales-motion/analyze] Failed to create conversation:", e);
          }

          send("complete", { collectionId });
        } catch (error) {
          console.error("[sales-motion/analyze] Error:", error);
          send("error", { message: error instanceof Error ? error.message : "Analysis failed" });

          // Try to mark as failed
          try {
            await prisma.salesMotionCollection.update({
              where: { id: collectionId },
              data: { status: "draft" },
            });
          } catch {
            // ignore cleanup error
          }
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
    console.error("[sales-motion/analyze] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start analysis" }), { status: 500 });
  }
}
