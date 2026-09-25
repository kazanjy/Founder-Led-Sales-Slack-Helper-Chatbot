import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

export const maxDuration = 60;

// POST - Hybrid search: find the best matching objection handle
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { objection, orgPersona, humanPersona } = await request.json();

    if (!objection) {
      return NextResponse.json({ error: "Objection text is required" }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { userId: user.id };
    if (orgPersona) where.orgPersona = { contains: orgPersona, mode: "insensitive" };
    if (humanPersona) where.humanPersona = { contains: humanPersona, mode: "insensitive" };

    const allEntries = await prisma.objectionEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    if (allEntries.length === 0) {
      return NextResponse.json({
        matches: [],
        message: "No objection entries found. Bootstrap your library first.",
      });
    }

    // Step 1: Text match — keyword overlap scoring
    const inputNormalized = objection.toLowerCase().trim();
    const stopWords = new Set(["i", "we", "the", "a", "an", "is", "are", "was", "were", "do", "does", "did", "to", "of", "in", "for", "on", "with", "at", "by", "from", "it", "this", "that", "not", "but", "and", "or", "if", "so", "no", "yes", "just", "have", "has", "had", "be", "been", "can", "could", "would", "should", "my", "our", "your", "they", "them"]);
    const inputKeywords = inputNormalized
      .split(/\s+/)
      .filter((w: string) => w.length > 2 && !stopWords.has(w));

    const scored = allEntries.map((entry) => {
      const entryText = entry.objection.toLowerCase();
      const matchCount = inputKeywords.filter((kw: string) => entryText.includes(kw)).length;
      const score = inputKeywords.length > 0 ? matchCount / inputKeywords.length : 0;
      return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // If top match has > 60% keyword overlap, return top 3 text matches
    if (scored[0]?.score >= 0.6) {
      const topMatches = scored.slice(0, 3).filter((s) => s.score > 0.3);
      return NextResponse.json({
        matches: topMatches.map((m) => ({
          entry: m.entry,
          confidence: Math.round(m.score * 100),
          method: "text",
        })),
      });
    }

    // Step 2: Semantic match via AI
    const numberedList = allEntries
      .map((e, i) => `${i + 1}. "${e.objection}"`)
      .join("\n");

    const prompt = `A prospect just said: "${objection}"

Here are all the stored objections in the user's library:
${numberedList}

Which of these objections is the prospect expressing? Return the number(s) of the closest match(es) (up to 3), or "none" if no match.

Respond with ONLY a JSON object: { "matches": [1, 5] } or { "matches": [] }
Do NOT include any explanation.`;

    try {
      const result = await sendToChatbase(prompt);
      let response = result.response.trim();
      if (response.startsWith("```json")) response = response.slice(7);
      else if (response.startsWith("```")) response = response.slice(3);
      if (response.endsWith("```")) response = response.slice(0, -3);
      response = response.trim();

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const indices: number[] = Array.isArray(parsed.matches) ? parsed.matches : [];

        const matches = indices
          .filter((i) => i >= 1 && i <= allEntries.length)
          .slice(0, 3)
          .map((i) => ({
            entry: allEntries[i - 1],
            confidence: 70,
            method: "semantic",
          }));

        if (matches.length > 0) {
          return NextResponse.json({ matches });
        }
      }
    } catch (aiError) {
      console.error("[objection-library/match] AI match error:", aiError);
    }

    // No match found
    return NextResponse.json({
      matches: [],
      message: "No close match found. Consider adding this as a new objection entry.",
    });
  } catch (error) {
    console.error("Error matching objection:", error);
    return NextResponse.json(
      { error: "Failed to match objection" },
      { status: 500 }
    );
  }
}
