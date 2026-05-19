import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enrichAttendeesByEmail } from "@/lib/search/pdl";

/**
 * POST /api/google-calendar/enrich-event
 *
 * Takes the external attendees from a calendar event (passed by the
 * client out of the /upcoming response) and runs People Data Labs
 * enrichment on each. Returns the enriched attendees plus a single
 * `prefill` object the research form can drop straight in.
 *
 * Picking the primary prospect: prefer a PDL hit with both company
 * and title (high-confidence), then a hit with company, then any
 * non-public-domain attendee, then anything. If person enrichment
 * misses for everyone we still try PDL's company-by-domain endpoint
 * so the form at least gets a richer company name than the
 * "Tryflint" first-word capitalization heuristic.
 */

interface Attendee {
  email: string;
  name?: string | null;
}

interface PDLCompanyHit {
  name?: string | null;
  display_name?: string | null;
  website?: string | null;
}

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "live.com", "msn.com",
]);

function domainFromEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase() || null;
}

async function enrichCompanyByDomain(domain: string): Promise<PDLCompanyHit | null> {
  const key = process.env.PDL_API_KEY;
  if (!key) return null;
  try {
    const url = `https://api.peopledatalabs.com/v5/company/enrich?website=${encodeURIComponent(domain)}`;
    const res = await fetch(url, { headers: { "X-Api-Key": key } });
    if (!res.ok) {
      console.log(`[enrich-event] PDL company enrich ${res.status} for ${domain}`);
      return null;
    }
    return (await res.json()) as PDLCompanyHit;
  } catch (err) {
    console.error("[enrich-event] PDL company enrich threw:", err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as { attendees?: Attendee[] };
  const attendees = Array.isArray(body.attendees) ? body.attendees : [];
  if (attendees.length === 0) {
    return NextResponse.json({ enrichedAttendees: [], prefill: null, pdlHits: 0 });
  }

  console.log(
    `[enrich-event] User ${user.id} enriching ${attendees.length} attendee(s):`,
    attendees.map((a) => a.email).join(", ")
  );

  // Run PDL person enrichment per attendee.
  const enriched = await enrichAttendeesByEmail(
    attendees.map((a) => ({ name: a.name || "", email: a.email }))
  );

  const enrichedWithDomain = enriched.map((a) => ({
    ...a,
    _domain: domainFromEmail(a.email),
  }));

  const pdlHits = enrichedWithDomain.filter((a) => a.company || a.title).length;
  console.log(
    `[enrich-event] PDL person hits: ${pdlHits}/${attendees.length}. ` +
      enrichedWithDomain
        .map((a) => `${a.email}=${a.company ? "company" : "-"}/${a.title ? "title" : "-"}`)
        .join(", ")
  );

  const primary =
    enrichedWithDomain.find(
      (a) => a.company && a.title && a._domain && !PUBLIC_EMAIL_DOMAINS.has(a._domain)
    ) ||
    enrichedWithDomain.find((a) => a.company && a._domain && !PUBLIC_EMAIL_DOMAINS.has(a._domain)) ||
    enrichedWithDomain.find((a) => a._domain && !PUBLIC_EMAIL_DOMAINS.has(a._domain)) ||
    enrichedWithDomain[0] ||
    null;

  const primaryDomain = primary?._domain ?? null;

  // If person enrichment didn't get a company name AND we have a
  // non-public domain to work with, try PDL company-by-domain so the
  // form picks up a real org name (e.g. "Flint" instead of "Tryflint")
  // even when no individual matched.
  let companyFromDomain: PDLCompanyHit | null = null;
  if (
    primary &&
    !primary.company &&
    primaryDomain &&
    !PUBLIC_EMAIL_DOMAINS.has(primaryDomain)
  ) {
    companyFromDomain = await enrichCompanyByDomain(primaryDomain);
    if (companyFromDomain) {
      console.log(
        `[enrich-event] Company fallback hit for ${primaryDomain}: ${companyFromDomain.display_name || companyFromDomain.name}`
      );
    }
  }

  const inferredCompanyUrl =
    companyFromDomain?.website
      ? (companyFromDomain.website.startsWith("http")
          ? companyFromDomain.website
          : `https://${companyFromDomain.website}`)
      : primaryDomain && !PUBLIC_EMAIL_DOMAINS.has(primaryDomain)
        ? `https://${primaryDomain}`
        : "";

  const prefill = primary
    ? {
        companyName:
          primary.company ||
          companyFromDomain?.display_name ||
          companyFromDomain?.name ||
          "",
        contactName: primary.name || "",
        contactTitle: primary.title || "",
        contactLinkedIn: primary.linkedinUrl || "",
        companyUrl: inferredCompanyUrl,
      }
    : null;

  return NextResponse.json({
    enrichedAttendees: enriched,
    prefill,
    pdlHits,
    companyFallback: !!companyFromDomain,
  });
}
