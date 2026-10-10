-- Persist Google OAuth tokens on the user so we can call Google APIs
-- (Calendar, etc.) on the user's behalf. All four columns are
-- nullable because existing Google-authed users only granted basic
-- identity scopes; they'll populate these on next re-auth. The
-- expires-at column lets us refresh proactively before calls; the
-- scopes column lets us detect when a user is missing a required
-- scope and prompt them to re-consent.

ALTER TABLE "users" ADD COLUMN "googleAccessToken" TEXT;
ALTER TABLE "users" ADD COLUMN "googleRefreshToken" TEXT;
ALTER TABLE "users" ADD COLUMN "googleTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "googleScopes" TEXT;
