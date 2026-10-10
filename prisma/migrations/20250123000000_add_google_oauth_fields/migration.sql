-- Add Google OAuth fields and make Slack fields optional for web-only users

-- Make slackUserId nullable (was required)
ALTER TABLE "users" ALTER COLUMN "slackUserId" DROP NOT NULL;

-- Make workspaceId nullable (was required)
ALTER TABLE "users" ALTER COLUMN "workspaceId" DROP NOT NULL;

-- Add Google OAuth fields
ALTER TABLE "users" ADD COLUMN "googleId" TEXT;
ALTER TABLE "users" ADD COLUMN "email" TEXT;
ALTER TABLE "users" ADD COLUMN "name" TEXT;
ALTER TABLE "users" ADD COLUMN "avatarUrl" TEXT;

-- Add unique constraints for Google users
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
