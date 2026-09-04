-- BroadcastCampaign + BroadcastDelivery: durable persistence for the
-- admin broadcast tool, including scheduled-for-later sends.

CREATE TABLE "broadcast_campaigns" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "workspaceId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "createdByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "broadcast_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "broadcast_campaigns_workspaceId_status_scheduledFor_idx"
  ON "broadcast_campaigns"("workspaceId", "status", "scheduledFor");
CREATE INDEX "broadcast_campaigns_workspaceId_createdAt_idx"
  ON "broadcast_campaigns"("workspaceId", "createdAt");

ALTER TABLE "broadcast_campaigns"
  ADD CONSTRAINT "broadcast_campaigns_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "broadcast_campaigns"
  ADD CONSTRAINT "broadcast_campaigns_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "broadcast_deliveries" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "channelClaimId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "slackMessageTs" TEXT,
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "broadcast_deliveries_pkey" PRIMARY KEY ("id")
);

-- Idempotency: a worker retry can't double-post into the same channel
-- within the same campaign.
CREATE UNIQUE INDEX "broadcast_deliveries_campaignId_channelClaimId_key"
  ON "broadcast_deliveries"("campaignId", "channelClaimId");

CREATE INDEX "broadcast_deliveries_campaignId_status_idx"
  ON "broadcast_deliveries"("campaignId", "status");

ALTER TABLE "broadcast_deliveries"
  ADD CONSTRAINT "broadcast_deliveries_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "broadcast_campaigns"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "broadcast_deliveries"
  ADD CONSTRAINT "broadcast_deliveries_channelClaimId_fkey"
  FOREIGN KEY ("channelClaimId") REFERENCES "channel_claims"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
