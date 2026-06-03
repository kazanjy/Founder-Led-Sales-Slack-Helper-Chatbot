import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

export const maxDuration = 180;

// POST - Iterate on an existing call script, streaming the result
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    const { id } = await params;
    const { feedback } = await request.json();

    if (!feedback?.trim()) {
      return new Response(JSON.stringify({ error: "Feedback is required" }), { status: 400 });
    }

    const script = await prisma.salesMotionCallScript.findFirst({
      where: { id },
      include: {
        collection: { select: { userId: true } },
      },
    });

    if (!script || script.collection.userId !== user.id) {
      return new Response(JSON.stringify({ error: "Script not found" }), { status: 404 });
    }

    const prompt = `You are an expert B2B sales coach. You previously generated a call script/playbook for "${script.callType}" calls, and the user has provided feedback to revise it.

## CURRENT CALL SCRIPT:

${script.content}

## USER FEEDBACK:

${feedback.trim()}

## INSTRUCTIONS:

Revise the call script/playbook based on the feedback above. Keep what works well, improve or change what was called out.

Maintain the same section structure with ## headings:
- Call Overview
- Pre-Call Preparation
- Agenda / Structure
- Key Questions to Ask
- Content / Talking Points
- Common Objections & Responses
- Call Outcomes & Next Steps

Be specific and actionable. Output ONLY the revised markdown, no JSON wrapping.`;

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
          const updatedScript = await prisma.salesMotionCallScript.update({
            where: { id },
            data: {
              content: fullContent,
              iterationHistory: { push: feedback.trim() },
            },
          });

          send("complete", {
            id: updatedScript.id,
            callType: updatedScript.callType,
            title: updatedScript.title,
          });
        } catch (error) {
          console.error("[sales-motion/scripts/iterate] Error:", error);
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
    console.error("[sales-motion/scripts/iterate] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start iteration" }), { status: 500 });
  }
}
