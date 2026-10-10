-- Remember each user's preferred Slack channel for pre-call
-- research "Send to Slack" so they don't have to repick every
-- time. Channel name is cached alongside the id purely so the UI
-- can render "Send to #sales-research" without an extra round-trip
-- to Slack.

ALTER TABLE "users" ADD COLUMN "preferredResearchSlackChannelId" TEXT;
ALTER TABLE "users" ADD COLUMN "preferredResearchSlackChannelName" TEXT;
