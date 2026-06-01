import { prisma } from "@/lib/db";
import type { Deal } from "@prisma/client";

/**
 * Shared "find or create Potential deal for this domain" used by both
 * the recorder scanner and the calendar pre-call research cron.
 * Keeps the dedup contract in one place so neither pipeline spawns a
 * duplicate Potential when the other has recently done the work.
 */

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "live.com", "msn.com",
]);

function normalizeDomain(d: string | null | undefined): string {
  return (d || "").trim().toLowerCase().replace(/^www\./, "");
}

function companyNameFromDomain(domain: string): string {
  const root = domain.split(".")[0] || domain;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

export type AutoDetectResult =
  | { kind: "skipped_internal"; deal: null }
  | { kind: "skipped_public_domain"; deal: null }
  | { kind: "attached_existing"; deal: Deal }
  | { kind: "cooldown_hit"; deal: Deal } // existing deal found but recently dismissed/lost
  | { kind: "created_potential"; deal: Deal };

export async function ensurePotentialDealForDomain(opts: {
  userId: string;
  domain: string;
  companyName?: string;
  source: "recorder" | "calendar";
  cooldownDays?: number;
  selfDomains: Set<string>;
}): Promise<AutoDetectResult> {
  const domain = normalizeDomain(opts.domain);
  if (!domain) return { kind: "skipped_internal", deal: null };
  if (opts.selfDomains.has(domain)) return { kind: "skipped_internal", deal: null };
  if (PUBLIC_EMAIL_DOMAINS.has(domain)) return { kind: "skipped_public_domain", deal: null };

  // 1) Look for any active or potential deal already tracking this domain
  //    (via companyUrl or participant email). If found → attach.
  const active = await prisma.deal.findFirst({
    where: {
      userId: opts.userId,
      status: { notIn: ["dismissed", "closed_lost"] },
      OR: [
        { companyUrl: { contains: domain, mode: "insensitive" } },
        { participants: { some: { email: { endsWith: `@${domain}`, mode: "insensitive" } } } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  if (active) return { kind: "attached_existing", deal: active };

  // 2) Cooldown — if we recently created (or the user recently dismissed)
  //    a deal for this domain, don't spawn another. Prevents the two
  //    pipelines from fighting and prevents a dismiss-then-recreate loop.
  const cooldownDays = opts.cooldownDays ?? 30;
  const cutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);
  const recent = await prisma.deal.findFirst({
    where: {
      userId: opts.userId,
      createdAt: { gte: cutoff },
      OR: [
        { companyUrl: { contains: domain, mode: "insensitive" } },
        { participants: { some: { email: { endsWith: `@${domain}`, mode: "insensitive" } } } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent) return { kind: "cooldown_hit", deal: recent };

  // 3) Spawn a fresh Potential.
  const companyName = opts.companyName?.trim() || companyNameFromDomain(domain);
  const newDeal = await prisma.deal.create({
    data: {
      userId: opts.userId,
      name: `${companyName} — Potential`,
      companyName,
      companyUrl: `https://${domain}`,
      stage: "prospecting",
      status: "potential",
      source: opts.source,
    },
  });
  return { kind: "created_potential", deal: newDeal };
}

/**
 * Resolve the user's own email domains so callers can filter
 * internal attendees consistently. Returns lowercase, no www.
 */
export async function getSelfDomains(userId: string): Promise<Set<string>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, slackEmail: true, accountId: true },
  });
  const set = new Set<string>();
  const addEmail = (email: string | null | undefined) => {
    if (!email) return;
    const at = email.lastIndexOf("@");
    if (at < 0) return;
    const d = normalizeDomain(email.slice(at + 1));
    if (d) set.add(d);
  };
  addEmail(user?.email);
  addEmail(user?.slackEmail);
  if (user?.accountId) {
    const account = await prisma.account.findUnique({
      where: { id: user.accountId },
      select: { emailDomain: true },
    });
    const d = normalizeDomain(account?.emailDomain || null);
    if (d) set.add(d);
  }
  return set;
}
