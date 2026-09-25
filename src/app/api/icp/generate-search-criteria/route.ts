import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

// Allow up to 120s for AI generation
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { versionId } = await request.json();
    if (!versionId) {
      return NextResponse.json({ error: "versionId is required" }, { status: 400 });
    }

    const icpVersion = await prisma.icpVersion.findFirst({
      where: { id: versionId, userId: user.id },
    });

    if (!icpVersion) {
      return NextResponse.json({ error: "ICP version not found" }, { status: 404 });
    }

    const content = JSON.parse(icpVersion.content);
    const sections = content.sections;

    if (!sections || !Array.isArray(sections)) {
      return NextResponse.json({ error: "Invalid ICP content" }, { status: 400 });
    }

    // Format ICP sections for the prompt
    const icpText = sections
      .map((s: { name: string; description: string; items: string[] }) =>
        `### ${s.name}\n${s.description}\n${s.items.map((i: string) => `- ${i}`).join("\n")}`
      )
      .join("\n\n");

    const prompt = `You are an expert B2B sales operations specialist who configures prospecting tools. Your philosophy: NARROW beats BROAD. A smaller, highly-targeted list always outperforms a large unfocused one.

Given the Ideal Customer Profile below, generate specific search filter settings for these platforms:

1. **LinkedIn Sales Navigator** — Include these filters: Job Title, Seniority Level, Function, Company Headcount, Industry, Geography, Keywords. Also provide a ready-to-paste Boolean Search string for the keyword/boolean field. Use LinkedIn Sales Navigator's actual filter names and accepted values.

2. **Apollo.io** — Include these filters: Person Titles, Seniority, Department, # Employees, Industry & Sub-Industry, Technologies, Keywords. Use Apollo's actual filter categories.

## CRITICAL INSTRUCTIONS — TIGHT TARGETING:
- **Be as narrow and specific as possible.** It is far better to return a small, laser-focused list than a broad one. When in doubt, leave a filter value OUT.
- For Job Titles, use ONLY the exact titles from the Key Personas section. Do NOT add generic alternatives, synonyms, or "related" titles. 3-5 titles max per platform.
- For Seniority, pick ONLY the one or two levels that match the ICP — do not include a range.
- For Company Headcount, use the SINGLE tightest range that matches the ICP (e.g., "51-200" not "51-200, 201-500, 501-1000").
- For Industries, pick ONLY the 1-3 industries that are the dead-center fit. Do NOT pad with adjacent or tangentially related industries.
- For Geography, be as specific as the ICP allows (city/metro > state > country).
- Boolean searches should be tight: combine title AND industry AND company-size signals. Use NOT clauses to exclude noise (e.g., NOT "intern" NOT "student").
- Use ACTUAL filter names and values that exist on each platform.
- Include platform-specific tips for narrowing results further.
- Keep filter values practical and directly usable — users will copy-paste these into search UIs.

## OUTPUT FORMAT (CRITICAL):
Respond ONLY with a valid JSON array — no markdown, no code blocks, no explanation:
[
  {
    "name": "LinkedIn Sales Navigator",
    "filters": [
      { "facet": "Job Title", "values": ["VP of Engineering", "CTO"], "notes": "Use Current title filter" }
    ],
    "booleanSearch": "(\\"VP Engineering\\" OR \\"CTO\\") AND \\"SaaS\\"",
    "tips": ["Save this search to get weekly lead alerts", "Use the Spotlight filter to find people who changed jobs in the last 90 days"]
  }
]

## ICP CONTENT:
${icpText}`;

    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(prompt);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate search criteria. Please try again." },
        { status: 500 }
      );
    }

    // Parse the JSON array response
    let searchCriteria: Array<{
      name: string;
      filters: Array<{ facet: string; values: string[]; notes?: string }>;
      booleanSearch?: string;
      tips?: string[];
    }>;

    try {
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error("No JSON array found in response");
      }
      searchCriteria = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(searchCriteria) || searchCriteria.length === 0) {
        throw new Error("Invalid response structure");
      }
    } catch (parseError) {
      console.error("Failed to parse Chatbase response:", parseError);
      console.error("Raw response:", aiResponse);
      return NextResponse.json(
        { error: "Failed to parse generated criteria. Please try again." },
        { status: 500 }
      );
    }

    // Update the ICP version content with searchCriteria
    const updatedContent = { ...content, searchCriteria };
    await prisma.icpVersion.update({
      where: { id: versionId },
      data: { content: JSON.stringify(updatedContent) },
    });

    return NextResponse.json({ success: true, searchCriteria });
  } catch (error) {
    console.error("Error generating search criteria:", error);
    return NextResponse.json(
      { error: "Failed to generate search criteria" },
      { status: 500 }
    );
  }
}
