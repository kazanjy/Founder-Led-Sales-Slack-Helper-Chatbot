import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { createSequenceConversation } from "@/lib/sequences/sequence-conversation";

// Allow up to 120s for OpenAI generation
export const maxDuration = 120;

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: "LinkedIn Ads",
  "facebook-instagram": "Facebook & Instagram Ads",
  "google-sem": "Google SEM Ads",
};

// POST - Generate ad concepts from sales narrative + persona
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { orgPersona, humanPersona, specialNotes, tone, platforms, includeFirstCallChecklist } = await request.json();

    if (!orgPersona || !humanPersona) {
      return NextResponse.json(
        { error: "Organization persona and target audience are required" },
        { status: 400 }
      );
    }

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json(
        { error: "At least one platform must be selected" },
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

    // Build context (variable-length)
    let contextSection = `## SALES NARRATIVE:\n\n${latestNarrative.narrative}`;
    if (checklistContent) {
      contextSection += `\n\n## FIRST CALL CHECKLIST (for additional context):\n\n${checklistContent}`;
    }

    const platformList = platforms.map((p: string) => PLATFORM_LABELS[p] || p).join(", ");
    const platformInstructions = buildPlatformInstructions(platforms);

    // Instructions first so they survive truncation
    const instructionPrompt = `You are an expert B2B performance marketing strategist helping a founder create ad concepts across multiple platforms.

## INSTRUCTIONS:

Generate ad copy and creative/visual direction for the selected platforms. For each platform, create 2-3 distinct concept variations with different angles/hooks.

${platformInstructions}

For EVERY ad concept, include a **Creative Direction** section describing:
- What the visual/image should convey
- Suggested imagery, mood, and style
- Color palette or visual tone recommendations
- Composition ideas (e.g. "split screen showing before/after", "hero shot of dashboard")

The tone should be authentic and founder-led, not corporate or generic.${tone ? `\n\n**Voice/Tone directive:** Write all ad copy in a ${tone} tone. Let this voice permeate headlines, descriptions, and body copy consistently across all platforms.` : ""}

## TARGET PERSONA:

- **Organization type:** ${orgPersona}
- **Target audience:** ${humanPersona}
- **Platforms:** ${platformList}
${specialNotes ? `- **Special notes:** ${specialNotes}` : ""}

## OUTPUT FORMAT:

Return clean markdown (NO code blocks). Use ## headers for each platform section with an anchor ID in the format {#anchor-id}. Use ### for each concept variation. Start with a brief # title line.`;

    const fullPrompt = `${instructionPrompt}\n\n${contextSection}`;

    console.log(`[ad-creator/generate] Sending to GPT-5.2: ${fullPrompt.length} chars`);

    let aiResponse = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.5",
        messages: [{ role: "user", content: fullPrompt }],
      });
      aiResponse = response.choices[0]?.message?.content || "";
    } catch (openaiError) {
      console.error("OpenAI API error:", openaiError);
      return NextResponse.json(
        { error: "Failed to generate ad concepts. Please try again." },
        { status: 500 }
      );
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

    // Save to DB
    const version = await prisma.adCreatorVersion.create({
      data: {
        userId: user.id,
        salesNarrativeVersionId: latestNarrative.id,
        firstCallChecklistVersionId: checklistVersionId,
        orgPersona,
        humanPersona,
        specialNotes: specialNotes || null,
        tone: tone || null,
        platforms,
        content: cleanedResponse,
      },
    });

    // Create linked chat conversation
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
    const reportUrl = `${appUrl}/ad-creator?version=${version.id}`;

    const conversation = await createSequenceConversation({
      userId: user.id,
      sequenceType: "ad-creator",
      orgPersona,
      humanPersona,
      specialNotes,
      content: cleanedResponse,
      reportUrl,
    });

    // Update version with conversation ID
    await prisma.adCreatorVersion.update({
      where: { id: version.id },
      data: { conversationId: conversation.id },
    });

    // Update GTM merge variable
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "AD_CREATOR",
        },
      },
      update: { value: cleanedResponse },
      create: {
        userId: user.id,
        mergeField: "AD_CREATOR",
        name: "Ad Creator",
        value: cleanedResponse,
        isDefault: false,
      },
    });

    return NextResponse.json({
      success: true,
      version: {
        id: version.id,
        content: cleanedResponse,
        orgPersona,
        humanPersona,
        specialNotes: specialNotes || null,
        tone: tone || null,
        platforms,
        salesNarrativeVersionId: latestNarrative.id,
        firstCallChecklistVersionId: checklistVersionId,
        conversationId: conversation.id,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error generating ad concepts:", error);
    return NextResponse.json(
      { error: "Failed to generate ad concepts" },
      { status: 500 }
    );
  }
}

function buildPlatformInstructions(platforms: string[]): string {
  const sections: string[] = [];

  if (platforms.includes("linkedin")) {
    sections.push(`### LinkedIn Ads
For each concept include:
- **Ad Format** (Sponsored Content, Message Ad, or Document Ad)
- **Headline** (max 70 characters)
- **Intro Text** (max 600 characters — the text above the image)
- **Description** (max 100 characters)
- **CTA Button** (e.g. Learn More, Sign Up, Download)
- **Creative Direction** (visual concept description)`);
  }

  if (platforms.includes("facebook-instagram")) {
    sections.push(`### Facebook & Instagram Ads
For each concept include:
- **Ad Format** (Feed Ad, Story Ad, or Carousel)
- **Primary Text** (max 125 characters for best performance)
- **Headline** (max 40 characters)
- **Description** (max 30 characters)
- **CTA Button** (e.g. Learn More, Sign Up, Get Quote)
- **Creative Direction** (visual concept description)
Include at least one Story-format concept.`);
  }

  if (platforms.includes("google-sem")) {
    sections.push(`### Google SEM (Search) Ads
For each ad group include:
- **Headlines** (up to 15, each max 30 characters)
- **Descriptions** (up to 4, each max 90 characters)
- **Target Keywords** (5-10 keywords with match types)
- **Negative Keywords** (3-5 to exclude)
Create 2-3 ad groups targeting different search intents.`);
  }

  return sections.join("\n\n");
}
