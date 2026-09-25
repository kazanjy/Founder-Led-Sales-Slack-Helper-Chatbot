-- Add user-scope Slack token storage so admins can post broadcast
-- messages as themselves (not as MikeyBot). Both columns are nullable
-- because every existing installation only granted bot scopes; users
-- will populate these on next re-auth.

ALTER TABLE "users" ADD COLUMN "slackUserToken" TEXT;
ALTER TABLE "users" ADD COLUMN "slackUserScopes" TEXT;
