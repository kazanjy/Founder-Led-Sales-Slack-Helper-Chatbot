import { prisma } from "@/lib/db";

/**
 * Extracts the email domain from an email address.
 * Returns null for common free email providers (gmail, outlook, etc.)
 * since those shouldn't auto-group users into the same account.
 */
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "mail.com",
  "yandex.com",
  "fastmail.com",
]);

function extractCompanyDomain(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if (FREE_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}

/**
 * Derives a display name from an email domain.
 * e.g., "acme.com" → "Acme", "my-startup.io" → "My Startup"
 */
function accountNameFromDomain(domain: string): string {
  const name = domain.split(".")[0]; // strip TLD
  return name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Finds or creates an Account for a newly created user based on their email.
 *
 * Logic:
 * 1. Extract company domain from email (skip free providers)
 * 2. If a company domain exists, look for an existing Account with that emailDomain
 *    - Found: add user as MEMBER
 *    - Not found: create new Account, add user as OWNER
 * 3. If no company domain (free email), create a personal Account for the user as OWNER
 *
 * Returns the updated user with accountId set.
 */
export async function findOrCreateAccountForUser(
  userId: string,
  email: string,
  userName?: string | null
) {
  const companyDomain = extractCompanyDomain(email);

  if (companyDomain) {
    // Look for existing account with this domain
    const existingAccount = await prisma.account.findUnique({
      where: { emailDomain: companyDomain },
    });

    if (existingAccount) {
      // Join existing account as MEMBER
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          accountId: existingAccount.id,
          accountRole: "MEMBER",
        },
      });
      console.log(
        `[Account] User ${userId} joined existing account "${existingAccount.name}" (${existingAccount.id}) as MEMBER`
      );
      return updatedUser;
    }

    // Create new account for this domain
    const account = await prisma.account.create({
      data: {
        name: accountNameFromDomain(companyDomain),
        emailDomain: companyDomain,
      },
    });

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        accountId: account.id,
        accountRole: "OWNER",
      },
    });
    console.log(
      `[Account] Created account "${account.name}" (${account.id}) for domain ${companyDomain}, user ${userId} is OWNER`
    );
    return updatedUser;
  }

  // Free email provider — create a personal account (no domain grouping)
  const accountName = userName || email.split("@")[0];
  const account = await prisma.account.create({
    data: {
      name: `${accountName}'s Account`,
      // No emailDomain — won't auto-group other users
    },
  });

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      accountId: account.id,
      accountRole: "OWNER",
    },
  });
  console.log(
    `[Account] Created personal account "${account.name}" (${account.id}) for user ${userId} (free email)`
  );
  return updatedUser;
}
