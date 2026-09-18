import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/pre-call-planning/research/by-domain
 *
 * Look up existing PreCallResearch briefs that look relevant to a
 * given domain (or company name). Used by the New Deal modal to
 * surface prior briefs the founder has already generated for the
 * prospect — they can multi-select to attach them to the new deal's
 * timeline at create time (Phase 4 of the deals/pre-call fusion).
 *
 * Match rules:
 *   - PreCallResearch.companyName ILIKE %domainRoot% (matches "Acme"
 *     against the "acme" segment of "acme.com")
 *   - calendarEvent.attendees[].email ends with @<domain> — picked up
 *     by an in-memory scan of the JSON column since Prisma's JSON-
 *     path filters aren't portable enough for this.
 *
 * Query params:
 *   - domain (required): e.g. "acme.com"
 *   - days (optional, default 90, max 365): how far back to search
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const url = new URL(request.url);
    const domainRaw = url.searchParams.get("domain") || "";
    const domain = domainRaw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
    if (!domain) {
      return NextResponse.json({ error: "domain is required" }, { status: 400 });
    }
    const daysRaw = parseInt(url.searchParams.get("days") || "", 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 90;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const domainRoot = domain.split(".")[0] || domain;

    // Pull every recent brief for the user once; matching happens
    // in-memory below (calendarEvent.attendees is a JSON array, hard
    // to filter precisely from Prisma).
    const candidates = await prisma.preCallResearch.findMany({
      where: { userId: user.id, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        contactTitle: true,
        content: true,
        createdAt: true,
        calendarEvent: true,
      },
      take: 250,
    });

    const matches = candidates.filter((c) => {
      if (c.companyName && c.companyName.toLowerCase().includes(domainRoot)) return true;
      const cal = c.calendarEvent as { attendees?: Array<{ email?: string }> } | null;
      if (cal?.attendees) {
        for (const a of cal.attendees) {
          const e = (a.email || "").toLowerCase();
          if (e.endsWith(`@${domain}`)) return true;
        }
      }
      return false;
    });

    // Surface only the fields the picker needs — content gets sliced
    // to a preview so the response stays small.
    const briefs = matches.map((c) => ({
      id: c.id,
      companyName: c.companyName,
      contactName: c.contactName,
      contactTitle: c.contactTitle,
      createdAt: c.createdAt,
      preview: c.content
        ? (c.content.length > 400 ? c.content.slice(0, 400).trimEnd() + "…" : c.content)
        : "",
    }));

    return NextResponse.json({ briefs, domain });
  } catch (err) {
    console.error("[pre-call-planning/research/by-domain] failed:", err);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}
