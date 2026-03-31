import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

export const maxDuration = 180;

// POST - Iterate on first call checklist, creating a new version
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

    const version = await prisma.firstCallChecklistVersion.findFirst({
      where: { id: versionId, userId: user.id },
    });

    if (!version) {
      return new Response(JSON.stringify({ error: "Version not found" }), { status: 404 });
    }

    const prompt = `You are an expert at crafting first-call checklists for B2B sales. You previously generated a first call checklist, and the founder has provided feedback to revise it.

## CURRENT FIRST CALL CHECKLIST (JSON format):

${version.content}

## USER FEEDBACK:

${feedback.trim()}

## INSTRUCTIONS:

Revise the first call checklist based on the feedback above. Keep what works well, improve or change what was called out.

Maintain the SAME JSON format with sections, each containing:
- title: section title
- items: array of checklist items (strings)

Respond ONLY with valid JSON (no markdown code blocks). The JSON should be a single object with a "sections" array.`;

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

          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            send("error", { message: "Failed to parse response" });
            return;
          }

          const parsed = JSON.parse(jsonMatch[0]);
          const newContent = JSON.stringify(parsed);

          // Create new version
          const newVersion = await prisma.firstCallChecklistVersion.create({
            data: {
              userId: user.id,
              title: version.title,
              content: newContent,
              discoveryQuestionsVersionId: version.discoveryQuestionsVersionId,
            },
          });

          // Upsert GTM variable
          const formattedContent = parsed.sections?.map((sec: { title: string; items: string[] }) => {
            let out = `## ${sec.title}\n\n`;
            for (const item of sec.items) out += `- ${item}\n`;
            return out;
          }).join("\n") || "";

          await prisma.gtmVariable.upsert({
            where: { userId_mergeField: { userId: user.id, mergeField: "FIRST_CALL_CHECKLIST" } },
            update: { value: formattedContent },
            create: { userId: user.id, mergeField: "FIRST_CALL_CHECKLIST", name: "First Call Checklist", value: formattedContent, isDefault: false },
          });

          send("complete", {
            versionId: newVersion.id,
            title: newVersion.title,
            content: parsed,
            iterationPrompt: feedback.trim(),
          });
        } catch (error) {
          console.error("[first-call-checklist/iterate] Error:", error);
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
    console.error("[first-call-checklist/iterate] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start iteration" }), { status: 500 });
  }
}
