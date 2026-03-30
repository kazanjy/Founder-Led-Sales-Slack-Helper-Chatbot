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

    const { recordingUrl, callSummary, callTranscript, customNotes, toneGuidance: toneFromBody } = await request.json();

    if (!recordingUrl || !callSummary?.trim()) {
      return new Response(
        JSON.stringify({ error: "recordingUrl and callSummary are required" }),
        { status: 400 }
      );
    }

    // Load latest Sales Narrative (best effort)
    const salesNarrative = await prisma.salesNarrativeVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }).catch(() => null);

    // Load latest Sales Motion (best effort)
    const salesMotion = await prisma.salesMotionCollection.findFirst({
      where: { userId: user.id, status: "complete" },
      orderBy: { createdAt: "desc" },
    }).catch(() => null);

    // Load tone guidance — from body or from GTM variable
    let toneGuidance = toneFromBody || "";
    if (!toneGuidance) {
      const toneVar = await prisma.gtmVariable.findUnique({
        where: { userId_mergeField: { userId: user.id, mergeField: "RECAP_TONE_GUIDANCE" } },
      }).catch(() => null);
      if (toneVar?.value) toneGuidance = toneVar.value;
    }

    let contextSection = "";
    if (salesNarrative?.narrative) {
      contextSection += `\n## SALES NARRATIVE (for tone and positioning reference):\n\n${salesNarrative.narrative}\n`;
    }
    if (salesMotion?.salesMotionSynthesis) {
      contextSection += `\n## SALES MOTION (for process and next-steps reference):\n\n${salesMotion.salesMotionSynthesis}\n`;
    }
    if (toneGuidance.trim()) {
      contextSection += `\n## TONE & POLISH GUIDANCE (apply this to the email style):\n\n${toneGuidance.trim()}\n`;
    }

    const prompt = `You are an expert sales communication assistant helping a founder craft professional follow-up emails after sales calls. You have deep knowledge of B2B sales best practices.
${contextSection}
## CALL INFORMATION:

**Recording URL:** ${recordingUrl}

**Call Summary:**
${callSummary.trim()}
${callTranscript ? `\n**Call Transcript:**\n${callTranscript.trim()}\n` : ""}${customNotes ? `\n**Custom Notes from Founder:**\n${customNotes.trim()}\n` : ""}

---

## INSTRUCTIONS:

Based on the call information above${contextSection ? " and the sales context provided" : ""}, produce the following output in this EXACT plain-text format (NOT JSON):

TITLE: [Account Name] - [Call Type] - [Participant Names joined by " + "]
CALL_TYPE: [one of: discovery, demo, proposal, negotiation, security, closing, other]
SUBJECT: [Professional email subject line for the follow-up]
---EMAIL---
[Full professional follow-up email body. Include:
- Warm greeting referencing the conversation
- Key takeaways and discussion highlights
- Action items with clear owners
- Next steps with suggested timelines${salesMotion?.salesMotionSynthesis ? "\n- Next steps informed by the sales motion context" : ""}
- Professional sign-off

Write in the founder's voice — confident, concise, and helpful. Do not use overly formal or stiff language.]

Rules:
1. Classify the call type based on the content: discovery (initial exploration), demo (product demonstration), proposal (pricing/terms discussion), negotiation (deal negotiation), security (security/compliance review), closing (final agreement), or other.
2. Extract the account/company name and participant names from the call summary or transcript.
3. The TITLE format must be: "Account - Call Type Label - Participant1 + Participant2"
4. The email subject should be specific and reference the actual conversation topics.
5. Output the structured header lines first, then ---EMAIL--- separator, then the full email body.`;

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
          let headersParsed = false;
          let title = "";
          let callType = "";
          let emailSubject = "";
          let emailBodyStartIndex = -1;

          for await (const chunk of llmStream) {
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
              fullContent += token;
              send("token", { token });

              // Try to parse headers once we have the ---EMAIL--- separator
              if (!headersParsed && fullContent.includes("---EMAIL---")) {
                headersParsed = true;
                const headerSection = fullContent.split("---EMAIL---")[0];
                const lines = headerSection.split("\n");

                for (const line of lines) {
                  const trimmed = line.trim();
                  if (trimmed.startsWith("TITLE:")) {
                    title = trimmed.substring("TITLE:".length).trim();
                  } else if (trimmed.startsWith("CALL_TYPE:")) {
                    callType = trimmed.substring("CALL_TYPE:".length).trim();
                  } else if (trimmed.startsWith("SUBJECT:")) {
                    emailSubject = trimmed.substring("SUBJECT:".length).trim();
                  }
                }

                emailBodyStartIndex = fullContent.indexOf("---EMAIL---") + "---EMAIL---".length;
              }
            }
          }

          // Extract email body (everything after ---EMAIL--- separator, trimmed)
          const emailBody = emailBodyStartIndex >= 0
            ? fullContent.substring(emailBodyStartIndex).trim()
            : fullContent;

          // Fallbacks
          if (!title) title = "Call Recap";
          if (!callType) callType = "other";
          if (!emailSubject) emailSubject = "Following up on our conversation";

          // Save to database
          const version = await prisma.callRecapVersion.create({
            data: {
              userId: user.id,
              recordingUrl,
              callSummary: callSummary.trim(),
              callTranscript: callTranscript?.trim() || null,
              customNotes: customNotes?.trim() || null,
              title,
              callType,
              emailSubject,
              emailBody,
            },
          });

          // Create a linked chat conversation
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";
          const recapUrl = `${appUrl}/call-recap?version=${version.id}`;
          const userMessage = `Generate a recap email for: ${title}`;
          const assistantContent = `[View full Recap Email](${recapUrl})\n\n**Subject:** ${emailSubject}\n\n${emailBody.substring(0, 500)}${emailBody.length > 500 ? "..." : ""}`;

          try {
            await prisma.conversation.create({
              data: {
                userId: user.id,
                source: "WEB",
                title: `Recap: ${title}`,
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
            console.error("[call-recap] Failed to create conversation:", e);
          }

          send("complete", {
            versionId: version.id,
            title,
            callType,
            emailSubject,
          });
        } catch (error) {
          console.error("[call-recap/generate-stream] Error:", error);
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
    console.error("[call-recap/generate-stream] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start generation" }), { status: 500 });
  }
}
