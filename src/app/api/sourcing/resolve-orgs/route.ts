import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { lookupOrganizations, pickOrg } from "@/lib/search/apollo";

export const maxDuration = 60;

/**
 * Resolve company names to Apollo organization ids.
 *
 * Free on Apollo's side, so a hiring profile naming forty companies
 * costs nothing to resolve. Ambiguous matches come back flagged rather
 * than silently accepted: "Skio" ranks SKIOLD GROUP first, and sourcing
 * the wrong company produces a plausible list of the wrong people,
 * which is the kind of error nobody notices.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { names } = await request.json();
    if (!Array.isArray(names) || names.length === 0) {
      return NextResponse.json({ error: "Provide an array of company names." }, { status: 400 });
    }

    const wanted = names
      .filter((n): n is string => typeof n === "string" && !!n.trim())
      .slice(0, 60);

    const resolved = [];
    for (const name of wanted) {
      // Sequential: free, but a burst still risks a rate limit that
      // would look like "company not found".
      const { orgs, error } = await lookupOrganizations(name, 5);
      const { org, confident } = pickOrg(name, orgs);
      resolved.push({
        query: name,
        id: org?.id ?? null,
        matchedName: org?.name ?? null,
        domain: org?.domain ?? null,
        confident,
        alternatives: orgs.filter((o) => o.id !== org?.id).slice(0, 4),
        error,
      });
    }

    return NextResponse.json({
      resolved,
      unresolved: resolved.filter((r) => !r.id).length,
      needsConfirmation: resolved.filter((r) => r.id && !r.confident).length,
    });
  } catch (error) {
    console.error("[sourcing/resolve-orgs]", error);
    return NextResponse.json({ error: "Failed to resolve companies" }, { status: 500 });
  }
}
