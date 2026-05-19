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
 * We pick the "primary" prospect by preferring an attendee whose PDL
 * lookup returned both a company and a job title — that's almost
 * always the human you're meeting. We fall back to the first
 * non-public-domain attendee, then the first attendee, so we always
 * return something usable.
 */

interface Attendee {
  email: string;
  name?: string | null;
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

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as { attendees?: Attendee[] };
  const attendees = Array.isArray(body.attendees) ? body.attendees : [];
  if (attendees.length === 0) {
    return NextResponse.json({ enrichedAttendees: [], prefill: null });
  }

  // Normalize for the PDL helper (it expects { name, email? }).
  const enriched = await enrichAttendeesByEmail(
    attendees.map((a) => ({ name: a.name || "", email: a.email }))
  );

  // Find the best prospect: one whose PDL hit has both company and
  // title (high-confidence match), then a non-public-domain match,
  // then anything.
  const enrichedWithDomain = enriched.map((a) => ({
    ...a,
    _domain: domainFromEmail(a.email),
  }));

  const primary =
    enrichedWithDomain.find(
      (a) => a.company && a.title && a._domain && !PUBLIC_EMAIL_DOMAINS.has(a._domain)
    ) ||
    enrichedWithDomain.find((a) => a.company && a._domain && !PUBLIC_EMAIL_DOMAINS.has(a._domain)) ||
    enrichedWithDomain.find((a) => a._domain && !PUBLIC_EMAIL_DOMAINS.has(a._domain)) ||
    enrichedWithDomain[0];

  const primaryDomain = primary?._domain ?? null;
  const inferredCompanyUrl =
    primaryDomain && !PUBLIC_EMAIL_DOMAINS.has(primaryDomain)
      ? `https://${primaryDomain}`
      : "";

  const prefill = primary
    ? {
        companyName: primary.company || "",
        contactName: primary.name || "",
        contactTitle: primary.title || "",
        contactLinkedIn: primary.linkedinUrl || "",
        companyUrl: inferredCompanyUrl,
      }
    : null;

  return NextResponse.json({ enrichedAttendees: enriched, prefill });
}
