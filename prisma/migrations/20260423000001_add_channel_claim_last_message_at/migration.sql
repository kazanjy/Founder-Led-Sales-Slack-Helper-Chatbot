-- AlterTable: add lastMessageAt to channel_claims so the admin broadcast
-- tool can rank channels by recency. Populated by the Slack event handler
-- on every non-bot channel message.
ALTER TABLE "channel_claims" ADD COLUMN "lastMessageAt" TIMESTAMP(3);

-- Composite index for `WHERE workspaceId = ? ORDER BY lastMessageAt DESC`
CREATE INDEX "channel_claims_workspaceId_lastMessageAt_idx"
  ON "channel_claims"("workspaceId", "lastMessageAt");
