import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { parseHiringRole } from "@/lib/hiring/role-types";

export const maxDuration = 120;

const MODEL = "gpt-5.5";

/**
 * Pull the sourcing target list out of a hiring profile.
 *
 * The generated profile already contains this: a "Where to Look"
 * section with tiered company lists, and usually a lower-priority or
 * "exceptions only" list that functions as an avoid list. Retyping
 * forty company names into the sourcing page is pure friction.
 *
 * Extraction goes through the model rather than a parser because the
 * section's shape varies between profiles — tier headings, bullet
 * groups and prose asides all appear — and a regex over that would
 * quietly drop companies. The model only LIFTS names that are present;
 * it is told not to invent any, because a hallucinated company would
 * resolve to a real Apollo org and silently source the wrong people.
 *
 * The avoid list comes back separately rather than being dropped. It is
 * not a search target, but the caller should be able to say what was
 * deliberately left out.
 */
const EXTRACT_PROMPT = `You are extracting a candidate-sourcing target list from a sales hiring profile.

Return ONLY JSON:
{
  "companies": [
    { "name": "<company name exactly as written>", "tier": 1, "group": "<the sub-heading it sat under, or null>" }
  ],
  "avoid": [
    { "name": "<company name>", "reason": "<short reason from the document, or null>" }
  ]
}

Rules:
- Look for a sourcing / "where to look" section listing companies to hire FROM.
- "tier" is the priority tier the document assigns: 1 for its highest-priority
  pool, 2 for strong adjacency, 3 for "screen hard" / possible. Use the
  document's own tiering. If it lists companies without tiers, use 1 for all.
- "group" is the sub-heading the company appeared under (e.g. "Product
  analytics / experimentation"), or null if there wasn't one.
- "avoid" is for companies the document says NOT to source from, or to treat as
  lower-priority / exceptions-only / a red flag. These are exclusions, not targets.
- ONLY include companies that literally appear in the document. Do NOT infer,
  expand, or add well-known companies in the same category. A name that isn't
  there must not appear in your output.
- Company names only. Do not include job titles, communities, events,
  conferences, Slack groups, newsletters, schools, or investors.
- Strip qualifiers from the name itself: "Mixpanel SMB/MM" is "Mixpanel",
  "Microsoft (enterprise)" is "Microsoft". Put nothing extra in "name".
- If the document contains no sourcing company list at all, return
  {"companies": [], "avoid": []}.`;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const roleType = parseHiringRole(body.roleType);

    // Account is the tenant boundary, exactly as in the assessor: a
    // teammate who didn't personally author the profile still sees the
    // account's, and nobody ever sees another account's.
    const scope = user.accountId
      ? { user: { accountId: user.accountId } }
      : { userId: user.id };

    const version = await prisma.hiringProfileVersion.findFirst({
      where: { ...scope, roleType },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, content: true, roleType: true, createdAt: true },
    });

    if (!version?.content) {
      return NextResponse.json(
        {
          error: `No ${roleType} hiring profile found yet. Generate one first and its "where to look" list will import here.`,
        },
        { status: 404 }
      );
    }

    const completion = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: EXTRACT_PROMPT },
        { role: "user", content: version.content.slice(0, 120_000) },
      ],
    });

    let parsed: {
      companies?: Array<{ name?: string; tier?: number; group?: string | null }>;
      avoid?: Array<{ name?: string; reason?: string | null }>;
    } = {};
    try {
      parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    } catch {
      return NextResponse.json({ error: "Couldn't read the profile's company list." }, { status: 502 });
    }

    // De-duplicate case-insensitively, keeping the best (lowest) tier —
    // profiles sometimes name the same company in two groups.
    const seen = new Map<string, { name: string; tier: number; group: string | null }>();
    for (const c of parsed.companies || []) {
      const name = (c.name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const tier = Number.isFinite(c.tier) ? Number(c.tier) : 1;
      const existing = seen.get(key);
      if (!existing || tier < existing.tier) {
        seen.set(key, { name, tier, group: c.group?.trim() || null });
      }
    }

    const companies = [...seen.values()].sort(
      (a, b) => a.tier - b.tier || a.name.localeCompare(b.name)
    );

    const avoid = (parsed.avoid || [])
      .map((a) => ({ name: (a.name || "").trim(), reason: a.reason?.trim() || null }))
      .filter((a) => a.name);

    return NextResponse.json({
      companies,
      avoid,
      profile: {
        id: version.id,
        title: version.title,
        roleType: version.roleType,
        createdAt: version.createdAt,
      },
    });
  } catch (error) {
    console.error("[sourcing/import-companies]", error);
    return NextResponse.json({ error: "Failed to import from the hiring profile" }, { status: 500 });
  }
}
