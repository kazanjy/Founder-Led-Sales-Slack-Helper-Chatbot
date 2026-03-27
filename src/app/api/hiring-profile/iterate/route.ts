import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

// Allow up to 120s for GPT-5.2 generation
export const maxDuration = 120;

// POST - Iterate on an existing hiring profile version based on user feedback
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { versionId, feedback } = await request.json();

    if (!versionId || !feedback?.trim()) {
      return NextResponse.json(
        { error: "Version ID and feedback are required" },
        { status: 400 }
      );
    }

    // Fetch the existing version
    const version = await prisma.hiringProfileVersion.findFirst({
      where: { id: versionId, userId: user.id },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Build the iteration prompt
    const prompt = `You are an expert sales hiring consultant. You previously generated an AE Hiring Profile report, and the founder has provided feedback to revise it.

## CURRENT HIRING PROFILE:

${version.content}

## USER FEEDBACK:

${feedback.trim()}

## INSTRUCTIONS:

Revise the AE Hiring Profile based on the feedback above. Keep what works well from the current version, and improve or change what was called out in the feedback.

Maintain the same section structure with ## headings:
- Role Summary
- Ideal Background
- Must-Have Experience
- Nice-to-Have Experience
- Where to Look
- Red Flags
- Interview Focus Areas
- Comp Expectations

Be specific and actionable — avoid generic advice.

Respond ONLY with valid JSON (no markdown code blocks):
{"title": "AE Hiring Profile - [brief descriptor]", "content": "The full revised markdown report..."}`;

    console.log(`[hiring-profile/iterate] Sending to GPT-5.2: ${prompt.length} chars`);

    let raw = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      });
      raw = response.choices[0]?.message?.content || "";
    } catch (gptError) {
      console.error("GPT-5.2 API error:", gptError);
      const errorMessage = gptError instanceof Error ? gptError.message : "Unknown error";
      return NextResponse.json(
        { error: `Failed to iterate on hiring profile: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Parse JSON response
    let parsedResponse: { title: string; content: string };
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      parsedResponse = JSON.parse(jsonMatch[0]);

      if (!parsedResponse.title || !parsedResponse.content) {
        throw new Error("Missing required fields in response");
      }
    } catch (parseError) {
      console.error("Failed to parse GPT-5.2 response:", parseError);
      console.error("Raw:", raw.substring(0, 500));
      return NextResponse.json(
        { error: "Failed to parse revised content. Please try again." },
        { status: 500 }
      );
    }

    // Update the version's content and append feedback to iterationHistory
    const updatedVersion = await prisma.hiringProfileVersion.update({
      where: { id: versionId },
      data: {
        title: parsedResponse.title,
        content: parsedResponse.content,
        iterationHistory: {
          push: feedback.trim(),
        },
      },
    });

    return NextResponse.json({
      success: true,
      version: {
        id: updatedVersion.id,
        title: updatedVersion.title,
        content: updatedVersion.content,
        iterationHistory: updatedVersion.iterationHistory,
        createdAt: updatedVersion.createdAt,
        updatedAt: updatedVersion.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error iterating hiring profile:", error);
    return NextResponse.json(
      { error: "Failed to iterate on hiring profile" },
      { status: 500 }
    );
  }
}
