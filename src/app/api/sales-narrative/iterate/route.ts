import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

export const maxDuration = 180;

// POST - Iterate on sales narrative, creating a new version
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    const { versionId, feedback } = await request.json();

    if (!versionId || !feedback?.trim()) {
      return new Response(JSON.stringify({ error: "Version ID and feedback are required" }), { status: 400 });
    }

    const version = await prisma.salesNarrativeVersion.findFirst({
      where: { id: versionId, userId: user.id },
    });

    if (!version) {
      return new Response(JSON.stringify({ error: "Version not found" }), { status: 404 });
    }

    const prompt = `You are an expert at crafting founder-led sales narratives for B2B startups. You previously generated a sales narrative, and the founder has provided feedback to revise it.

## CURRENT SALES NARRATIVE:

${version.narrative}

## CURRENT CONDENSED VERSIONS:

### 100-word version:
${version.description100w}

### 50-word version:
${version.description50w}

### 25-word version:
${version.description25w}

## USER FEEDBACK:

${feedback.trim()}

## INSTRUCTIONS:

Revise the sales narrative based on the feedback above. Keep what works well, improve or change what was called out.

Return a JSON object with these exact keys:
- "narrative": The full revised narrative (approx 800-1200 words, markdown formatted)
- "description100w": A 100-word condensed version
- "description50w": A 50-word elevator pitch version
- "description25w": A 25-word tagline version

Respond ONLY with valid JSON (no markdown code blocks).`;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
          const response = await openai.chat.completions.create({
            model: "gpt-5.2",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
          });

          const raw = response.choices[0]?.message?.content || "";

          // Parse JSON response
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            send("error", { message: "Failed to parse response" });
            controller.close();
            return;
          }

          const parsed = JSON.parse(jsonMatch[0]);

          // Create new version
          const newVersion = await prisma.salesNarrativeVersion.create({
            data: {
              userId: user.id,
              title: version.title,
              narrative: parsed.narrative || version.narrative,
              description1000w: version.description1000w,
              description100w: parsed.description100w || version.description100w,
              description50w: parsed.description50w || version.description50w,
              description25w: parsed.description25w || version.description25w,
              sourceUrls: version.sourceUrls,
              sourcePdfNames: version.sourcePdfNames,
            },
          });

          // Upsert GTM variable
          await prisma.gtmVariable.upsert({
            where: { userId_mergeField: { userId: user.id, mergeField: "SALES_NARRATIVE" } },
            update: { value: parsed.narrative || version.narrative },
            create: { userId: user.id, mergeField: "SALES_NARRATIVE", name: "Sales Narrative", value: parsed.narrative || version.narrative, isDefault: false },
          });

          send("complete", {
            versionId: newVersion.id,
            title: newVersion.title,
            narrative: parsed.narrative || version.narrative,
            description100w: parsed.description100w || version.description100w,
            description50w: parsed.description50w || version.description50w,
            description25w: parsed.description25w || version.description25w,
            iterationPrompt: feedback.trim(),
          });
        } catch (error) {
          console.error("[sales-narrative/iterate] Error:", error);
          send("error", { message: error instanceof Error ? error.message : "Iteration failed" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (error) {
    console.error("[sales-narrative/iterate] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start iteration" }), { status: 500 });
  }
}
