-- Linked shared Slack channel per deal (Slack Connect selling
-- channel). Additive, nullable — safe to apply to prod directly.
ALTER TABLE "deals" ADD COLUMN "slackChannelId" TEXT;
ALTER TABLE "deals" ADD COLUMN "slackChannelName" TEXT;
ALTER TABLE "deals" ADD COLUMN "slackChannelLastTs" TEXT;
