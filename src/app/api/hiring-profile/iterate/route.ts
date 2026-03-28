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
            model: "gpt-5.2",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
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

          // Save updated content and append feedback to history
          const updatedVersion = await prisma.hiringProfileVersion.update({
            where: { id: versionId },
            data: {
              content: fullContent,
              iterationHistory: { push: feedback.trim() },
            },
          });

          send("complete", {
            versionId: updatedVersion.id,
            title: updatedVersion.title,
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
