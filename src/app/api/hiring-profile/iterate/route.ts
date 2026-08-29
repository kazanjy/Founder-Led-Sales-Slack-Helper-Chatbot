import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

export const maxDuration = 180;

// POST - Iterate on an existing hiring profile version, streaming the result
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

    const version = await prisma.hiringProfileVersion.findFirst({
      where: { id: versionId, userId: user.id },
    });

    if (!version) {
      return new Response(JSON.stringify({ error: "Version not found" }), { status: 404 });
    }

    const prompt = `You are an expert sales hiring consultant. You previously generated an AE Hiring Profile report, and the founder has provided feedback to revise it.

## CURRENT HIRING PROFILE:

${version.content}

## USER FEEDBACK:

${feedback.trim()}

## INSTRUCTIONS:

Revise the AE Hiring Profile based on the feedback above. Keep what works well, improve or change what was called out.

Maintain the same section structure with ## headings:
- Role Summary
- Ideal Background
- Must-Have Experience
- Nice-to-Have Experience
- Where to Look
- Red Flags
- Interview Focus Areas
- Comp Expectations

Be specific and actionable. Output ONLY the revised markdown report, no JSON wrapping.`;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
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

          // Create a NEW version (not update in-place) with the iteration prompt recorded
          const newVersion = await prisma.hiringProfileVersion.create({
            data: {
              // Iterating refines the wording, never the seat.
              roleType: version.roleType,
              userId: user.id,
              title: version.title, // keep the same title
              content: fullContent,
              iterationHistory: [...(version.iterationHistory || []), feedback.trim()],
            },
          });

          // Copy answer snapshots from the original version to the new one
          const originalAnswers = await prisma.hiringProfileAnswer.findMany({
            where: { versionId: version.id },
          });
          if (originalAnswers.length > 0) {
            await prisma.hiringProfileAnswer.createMany({
              data: originalAnswers.map((a) => ({
                userId: a.userId,
                questionId: a.questionId,
                versionId: newVersion.id,
                answer: a.answer,
              })),
            });
          }

          send("complete", {
            versionId: newVersion.id,
            title: newVersion.title,
          });
        } catch (error) {
          console.error("[hiring-profile/iterate] Error:", error);
          send("error", { message: error instanceof Error ? error.message : "Iteration failed" });
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
    console.error("[hiring-profile/iterate] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start iteration" }), { status: 500 });
  }
}
