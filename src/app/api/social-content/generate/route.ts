import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { createSequenceConversation } from "@/lib/sequences/sequence-conversation";

// Allow up to 120s for OpenAI generation
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const {
      platform,
      tone,
      postCount,
      topicSource,
      topicInput,
      selectedTopics,
      styleGuidance,
      goldStandardExamples,
      includeFirstCallChecklist,
    } = await request.json();

    if (!platform || !tone || !topicSource) {
      return NextResponse.json(
        { error: "Platform, tone, and topic source are required" },
        { status: 400 }
      );
    }

    if (topicSource === "content" && !topicInput?.trim()) {
      return NextResponse.json(
        { error: "Please provide content to repurpose" },
        { status: 400 }
      );
    }
    if (topicSource === "custom" && !topicInput?.trim() && (!selectedTopics || selectedTopics.length === 0)) {
      return NextResponse.json(
        { error: "Please provide a topic or select topics" },
        { status: 400 }
      );
    }

    // Get the latest sales narrative
    const latestNarrative = await prisma.salesNarrativeVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!latestNarrative) {
      return NextResponse.json(
        { error: "No sales narrative found. Please create a sales narrative first." },
        { status: 400 }
      );
    }

    // Optionally get first call checklist
    let checklistContent: string | null = null;
    let checklistVersionId: string | null = null;
    if (includeFirstCallChecklist) {
      const latestChecklist = await prisma.firstCallChecklistVersion.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      if (latestChecklist) {
        checklistContent = latestChecklist.content;
        checklistVersionId = latestChecklist.id;
      }
    }

    // For multi-topic, enforce minimum 3 posts per topic
    const topics: string[] = selectedTopics || [];
    const minPosts = topics.length > 0 ? topics.length * 3 : 1;
    const count = Math.min(Math.max(postCount || 10, minPosts), 30);
    const platformLabel = platform === "linkedin" ? "LinkedIn" : "Twitter/X";
    const toneLabel = tone === "thought-leadership"
      ? "thought leadership (authoritative, insightful, data-backed perspective from someone who's been in the trenches)"
      : tone === "shitposting"
      ? `shitposting — snarky, irreverent, provocative. Channel the energy of the best tech Twitter/LinkedIn shitposters:
- Lead with a deliberately spicy or contrarian take
- Use sarcasm, dry wit, and absurdist humor
- Mock conventional wisdom, buzzwords, and performative LinkedIn behavior
- Short, punchy sentences. Fragment sentences. One-liners that hit.
- It's OK to be a little mean (to ideas, not people)
- Think "saying the quiet part out loud" energy
- No corporate-speak, no "I'm humbled", no "excited to announce"
- If it wouldn't make someone laugh or go "damn, that's true" — it's not snarky enough`
      : tone;

    // Build examples section
    let examplesSection = "";
    const examples: string[] = goldStandardExamples || [];
    if (examples.length > 0) {
      examplesSection = `\n\n## GOLD STANDARD EXAMPLES:\n\nThe user has provided these as examples of the style and format they want. Study the structure, length, hooks, and voice carefully — then match it:\n\n${examples.map((ex: string, i: number) => `### Example ${i + 1}:\n${ex}`).join("\n\n")}`;
    }

    // Build topic section
    let topicSection = "";
    if (topics.length > 0) {
      topicSection = `The user has selected ${topics.length} specific topics. Each post should focus on ONE topic. Generate at least 3 posts per topic, distributing the ${count} total posts across topics.

**SELECTED TOPICS:**
${topics.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}

IMPORTANT: At the START of each post (before the content), include a topic label like this:
**Topic:** [the topic this post is about]

Then a blank line, then the post content.`;
    } else if (topicSource === "narrative") {
      topicSection = `Generate topics organically from the sales narrative below. Pick angles that would resonate with the target audience on ${platformLabel}.

IMPORTANT: At the START of each post (before the content), include a topic label like this:
**Topic:** [a short topic label for this post]

Then a blank line, then the post content.`;
    } else if (topicSource === "custom") {
      topicSection = `The user wants posts about this specific topic:\n\n${topicInput}\n\nIMPORTANT: At the START of each post (before the content), include:\n**Topic:** [a short topic label]\n\nThen a blank line, then the post content.`;
    } else if (topicSource === "content") {
      topicSection = `The user wants to repurpose the following content into ${platformLabel} posts:\n\n${topicInput}\n\nIMPORTANT: At the START of each post (before the content), include:\n**Topic:** [a short topic label]\n\nThen a blank line, then the post content.`;
    }

    // Build context
    let contextSection = `## SALES NARRATIVE:\n\n${latestNarrative.narrative}`;
    if (checklistContent) {
      contextSection += `\n\n## FIRST CALL CHECKLIST (for additional context):\n\n${checklistContent}`;
    }

    const platformInstructions = platform === "linkedin"
      ? `Each post should:
- Open with a strong hook line (the first 1-2 lines people see before "...see more")
- Use line breaks for readability (LinkedIn rewards white space)
- Be 100-200 words (sweet spot for LinkedIn engagement)
- End with a question or call-to-action to drive comments
- Use NO hashtags unless specifically requested
- Feel like a real person sharing a real insight, not a brand posting content`
      : `Each post should:
- Be under 280 characters (hard limit for Twitter/X)
- Open with a punchy hook
- Be self-contained and quotable
- Use no hashtags unless specifically requested
- For threads, clearly label each tweet (1/, 2/, etc.) and make tweet 1/ standalone compelling
- Feel authentic, not like brand content
- Use line breaks between sentences for readability (each sentence on its own line)
- Add a blank line between paragraphs/thoughts within each tweet`;

    const instructionPrompt = `You are an expert ${platformLabel} ghostwriter helping a founder build their personal brand through social content.

## INSTRUCTIONS:

Generate exactly ${count} ${platformLabel} post${count > 1 ? "s" : ""} in the specified tone.

**Tone:** ${toneLabel}

**Topic Direction:** ${topicSection}

## PLATFORM RULES (${platformLabel}):

${platformInstructions}
${styleGuidance ? `\n## STYLE GUIDANCE FROM USER:\n\n${styleGuidance}\n\nFollow these style instructions carefully — they override default writing patterns.` : ""}

## OUTPUT FORMAT:

Return clean markdown (NO code blocks). For each post, use EXACTLY this structure:

## Post N

**Topic:** [short topic label]

[The actual post content — this is what gets copied and pasted into ${platformLabel}]

**Timing:** [Best day/time to post and why, e.g. "Tuesday 8am — catches morning commuters"]

**Visual:** [Suggested image/visual to pair with this post, e.g. "Screenshot of dashboard with metrics highlighted"]

---

IMPORTANT RULES:
- The post content MUST be between **Topic:** and **Timing:** — keep it clean, no extra labels
- **Timing:** and **Visual:** are metadata — they go AFTER the post content
- Use "---" as separator between posts${examplesSection}`;

    const fullPrompt = `${instructionPrompt}\n\n${contextSection}`;

    console.log(`[social-content/generate] Sending to GPT-5.2: ${fullPrompt.length} chars, ${count} posts, ${platform}, ${tone}`);

    // Stream the response via SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
          const llmStream = await openai.chat.completions.create({
            model: "gpt-5.5",
            messages: [{ role: "user", content: fullPrompt }],
            stream: true,
          });

          let aiResponse = "";
          for await (const chunk of llmStream) {
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
              aiResponse += token;
              send("token", { token });
            }
          }

          // Clean up the response
          let cleanedResponse = aiResponse.trim();
          if (cleanedResponse.startsWith("```markdown")) {
            cleanedResponse = cleanedResponse.slice(11);
          } else if (cleanedResponse.startsWith("```")) {
            cleanedResponse = cleanedResponse.slice(3);
          }
          if (cleanedResponse.endsWith("```")) {
            cleanedResponse = cleanedResponse.slice(0, -3);
          }
          cleanedResponse = cleanedResponse.trim();

          // Generate a short AI title
          let title = `${platformLabel} ${count > 1 ? "Posts" : "Post"} – ${tone}`;
          try {
            const titleResponse = await openai.chat.completions.create({
              model: "gpt-4.1-nano",
              messages: [
                {
                  role: "user",
                  content: `Generate a short, catchy title (max 8 words) summarizing these social media posts. Return ONLY the title, no quotes or punctuation around it.\n\n${cleanedResponse.slice(0, 1000)}`,
                },
              ],
              temperature: 0.7,
            });
            const generatedTitle = titleResponse.choices[0]?.message?.content?.trim();
            if (generatedTitle && generatedTitle.length <= 80) {
              title = generatedTitle;
            }
          } catch (titleError) {
            console.error("Failed to generate title, using fallback:", titleError);
          }

          // Save to DB
          const version = await prisma.socialContentVersion.create({
            data: {
              userId: user.id,
              salesNarrativeVersionId: latestNarrative.id,
              firstCallChecklistVersionId: checklistVersionId,
        platform,
        tone,
        postCount: count,
        topicSource,
        topicInput: topics.length > 0 ? JSON.stringify(topics) : (topicInput || null),
        goldStandardExamples: examples.length > 0 ? JSON.stringify(examples) : null,
        title,
        content: cleanedResponse,
      },
    });

    // Create linked chat conversation
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
    const reportUrl = `${appUrl}/social-content?version=${version.id}`;

    const conversation = await createSequenceConversation({
      userId: user.id,
      sequenceType: "social-content",
      orgPersona: `${platformLabel} ${toneLabel}`,
      humanPersona: `${count} posts`,
      specialNotes: topicSource === "custom" ? topicInput : topicSource === "content" ? "Repurposed content" : "From sales narrative",
      content: cleanedResponse,
      reportUrl,
    });

    // Update version with conversation ID
    await prisma.socialContentVersion.update({
      where: { id: version.id },
      data: { conversationId: conversation.id },
    });

    // Update GTM merge variable
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "SOCIAL_CONTENT",
        },
      },
      update: { value: cleanedResponse },
      create: {
        userId: user.id,
        mergeField: "SOCIAL_CONTENT",
        name: "Social Content",
        value: cleanedResponse,
        isDefault: false,
      },
    });

          send("complete", {
            versionId: version.id,
            title,
            content: cleanedResponse,
            platform,
            tone,
            postCount: count,
            conversationId: conversation.id,
          });
        } catch (error) {
          console.error("[social-content/generate] Stream error:", error);
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
    console.error("Error generating social content:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate social content" }),
      { status: 500 }
    );
  }
}
