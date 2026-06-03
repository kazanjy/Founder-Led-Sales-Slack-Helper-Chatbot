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

    const version = await prisma.callRecapVersion.findFirst({
      where: { id: versionId, userId: user.id },
    });

    if (!version) {
      return new Response(JSON.stringify({ error: "Version not found" }), { status: 404 });
    }

    const prompt = `You are an expert sales communication assistant. You previously generated a follow-up email after a sales call, and the founder has provided feedback to revise it.

## CALL CONTEXT:

**Title:** ${version.title}
**Call Type:** ${version.callType}
**Call Summary:** ${version.callSummary}

## CURRENT EMAIL:

**Subject:** ${version.emailSubject}

${version.emailBody}

## USER FEEDBACK:

${feedback.trim()}

## INSTRUCTIONS:

Revise the follow-up email based on the feedback above. Keep what works well, improve or change what was called out.

Output in this EXACT plain-text format (NOT JSON):

SUBJECT: [Revised subject line, or same if unchanged]
---EMAIL---
[Revised email body]

Only change the subject line if the feedback specifically asks for it, otherwise keep it the same.`;

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

          // Parse the response to extract subject and email body
          let newSubject = version.emailSubject;
          let newEmailBody = fullContent;

          if (fullContent.includes("---EMAIL---")) {
            const headerSection = fullContent.split("---EMAIL---")[0];
            const lines = headerSection.split("\n");

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("SUBJECT:")) {
                newSubject = trimmed.substring("SUBJECT:".length).trim();
              }
            }

            const emailStartIndex = fullContent.indexOf("---EMAIL---") + "---EMAIL---".length;
            newEmailBody = fullContent.substring(emailStartIndex).trim();
          }

          // Save updated content and append feedback to history
          const updatedVersion = await prisma.callRecapVersion.update({
            where: { id: versionId },
            data: {
              emailSubject: newSubject,
              emailBody: newEmailBody,
              iterationHistory: { push: feedback.trim() },
            },
          });

          send("complete", {
            versionId: updatedVersion.id,
            title: updatedVersion.title,
            emailSubject: updatedVersion.emailSubject,
          });
        } catch (error) {
          console.error("[call-recap/iterate] Error:", error);
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
    console.error("[call-recap/iterate] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start iteration" }), { status: 500 });
  }
}
