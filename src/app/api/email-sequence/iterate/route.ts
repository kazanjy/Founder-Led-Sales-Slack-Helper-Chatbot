import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

export const maxDuration = 180;

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

    const version = await prisma.emailSequenceVersion.findFirst({
      where: { id: versionId, userId: user.id },
    });

    if (!version) {
      return new Response(JSON.stringify({ error: "Version not found" }), { status: 404 });
    }

    const prompt = `You are an expert at crafting cold email outreach sequences for B2B sales. You previously generated an email sequence, and the founder has provided feedback to revise it.

## CURRENT EMAIL SEQUENCE:

${version.content}

## CONTEXT:
- Organization Persona: ${version.orgPersona || "N/A"}
- Target Role: ${version.humanPersona || "N/A"}
- Special Notes: ${version.specialNotes || "None"}

## USER FEEDBACK:

${feedback.trim()}

## INSTRUCTIONS:

Revise the email sequence based on the feedback above. Keep what works well, improve or change what was called out. Maintain the same markdown format with clear email numbering, subject lines, timing, and body content.

Respond ONLY with the revised email sequence content in markdown format (no JSON wrapping, no code blocks).`;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
          const response = await openai.chat.completions.create({
            model: "gpt-5.5",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
          });

          const content = response.choices[0]?.message?.content || "";

          const newVersion = await prisma.emailSequenceVersion.create({
            data: {
              userId: user.id,
              content,
              orgPersona: version.orgPersona,
              humanPersona: version.humanPersona,
              specialNotes: version.specialNotes,
              salesNarrativeVersionId: version.salesNarrativeVersionId,
              firstCallChecklistVersionId: version.firstCallChecklistVersionId,
            },
          });

          send("complete", {
            versionId: newVersion.id,
            content: newVersion.content,
            iterationPrompt: feedback.trim(),
          });
        } catch (error) {
          console.error("[email-sequence/iterate] Error:", error);
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
    console.error("[email-sequence/iterate] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start iteration" }), { status: 500 });
  }
}
