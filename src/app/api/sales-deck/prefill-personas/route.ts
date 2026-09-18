import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

export const maxDuration = 60;

interface IcpSection {
  name: string;
  description?: string;
  items?: string[];
}

interface IcpContent {
  sections?: IcpSection[];
}

// Pulls the relevant sections out of an ICP version content blob.
// The ICP generator stores `Company Characteristics` and
// `Key Personas` as canonical section names; match loosely so
// renames or capitalization changes still get picked up.
function pickIcpSections(content: IcpContent | null): {
  org: string;
  human: string;
} {
  if (!content?.sections?.length) return { org: "", human: "" };

  const findSection = (re: RegExp) =>
    content.sections!.find((s) => re.test(s.name || ""));

  const format = (s: IcpSection | undefined) => {
    if (!s) return "";
    const lines: string[] = [];
    if (s.description) lines.push(s.description);
    if (s.items?.length) lines.push(...s.items.map((i) => `- ${i}`));
    return lines.join("\n");
  };

  return {
    org: format(findSection(/compan(y|ies).*characteristic|firmograph|organi[sz]ation/i)),
    human: format(findSection(/persona|buyer|role|title/i)),
  };
}

// POST - AI prefill org/human persona, preferring the user's ICP and
// falling back to the latest sales narrative if no ICP exists.
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const [latestIcp, latestNarrative] = await Promise.all([
      prisma.icpVersion.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.salesNarrativeVersion.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    let icpSections: { org: string; human: string } = { org: "", human: "" };
    if (latestIcp) {
      try {
        icpSections = pickIcpSections(JSON.parse(latestIcp.content) as IcpContent);
      } catch {
        /* ignore malformed ICP content */
      }
    }

    const hasIcp = !!(icpSections.org || icpSections.human);

    if (!hasIcp && !latestNarrative) {
      return NextResponse.json(
        { error: "No ICP or sales narrative found." },
        { status: 400 }
      );
    }

    // Build the context block. Prefer ICP sections — they're the
    // canonical source of truth for who the user sells to. Include a
    // narrative snippet too when available so the AI can disambiguate
    // ICP sections that are vague.
    const contextParts: string[] = [];
    if (icpSections.org) {
      contextParts.push(`ICP — Company Characteristics:\n${icpSections.org}`);
    }
    if (icpSections.human) {
      contextParts.push(`ICP — Key Personas:\n${icpSections.human}`);
    }
    if (!hasIcp && latestNarrative) {
      const narrativeSummary =
        latestNarrative.description100w ||
        latestNarrative.description50w ||
        latestNarrative.description25w ||
        latestNarrative.narrative.substring(0, 2000);
      contextParts.push(`Sales Narrative Summary:\n${narrativeSummary}`);
    }

    const sourceLabel = hasIcp ? "ICP" : "sales narrative";
    const prompt = `You MUST respond ONLY with valid JSON (no markdown, no explanation, no code blocks).
Required format: { "orgPersona": "...", "humanPersona": "..." }

Based on the ${sourceLabel} below, suggest the most likely:
1. orgPersona — a one-sentence description of the type of company they sell to (industry, size, stage, and the key situational attribute that makes them a buyer). Draw directly from the ICP Company Characteristics if provided.
2. humanPersona — a one-sentence description of the specific buyer role they should target (title plus what they own and why they care). Draw directly from the ICP Key Personas if provided; pick the single best primary buyer.

Keep each persona under 240 characters. Be specific — no generic boilerplate.

${contextParts.join("\n\n")}`;

    let chatbaseResult;
    try {
      chatbaseResult = await sendToChatbase(prompt);
    } catch (chatbaseError) {
      console.error("[prefill-personas] Chatbase API call failed:", chatbaseError);
      return NextResponse.json(
        { error: "AI service is temporarily unavailable. You can fill in the personas manually." },
        { status: 502 }
      );
    }

    let aiResponse = chatbaseResult.response.trim();

    if (aiResponse.startsWith("```json")) {
      aiResponse = aiResponse.slice(7);
    } else if (aiResponse.startsWith("```")) {
      aiResponse = aiResponse.slice(3);
    }
    if (aiResponse.endsWith("```")) {
      aiResponse = aiResponse.slice(0, -3);
    }
    aiResponse = aiResponse.trim();

    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[prefill-personas] No JSON found in AI response:", aiResponse.substring(0, 500));
      return NextResponse.json(
        { error: "AI returned an unexpected format. You can fill in the personas manually." },
        { status: 422 }
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("[prefill-personas] JSON parse failed:", parseError, "Raw:", jsonMatch[0].substring(0, 500));
      return NextResponse.json(
        { error: "AI returned malformed data. You can fill in the personas manually." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      orgPersona: parsed.orgPersona || "",
      humanPersona: parsed.humanPersona || "",
      source: hasIcp ? "icp" : "narrative",
    });
  } catch (error) {
    console.error("[prefill-personas] Unexpected error:", error);
    return NextResponse.json(
      { error: "Failed to prefill personas. You can fill them in manually." },
      { status: 500 }
    );
  }
}
