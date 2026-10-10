-- Add admin-configured destination for "usage action" digest reports
-- posted into a Slack channel. All four columns are nullable: the
-- feature is opt-in, and existing rows must remain valid without a
-- backfill. activityBroadcastLastSentAt is the watermark used to slice
-- "since last send" digests.

ALTER TABLE "global_settings" ADD COLUMN "activityBroadcastWorkspaceId" TEXT;
ALTER TABLE "global_settings" ADD COLUMN "activityBroadcastChannelId"   TEXT;
ALTER TABLE "global_settings" ADD COLUMN "activityBroadcastChannelName" TEXT;
ALTER TABLE "global_settings" ADD COLUMN "activityBroadcastLastSentAt" TIMESTAMP(3);
