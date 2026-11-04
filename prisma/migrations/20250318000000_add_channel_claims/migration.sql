-- CreateTable
CREATE TABLE "channel_claims" (
    "id" TEXT NOT NULL,
    "slackChannelId" TEXT NOT NULL,
    "slackChannelName" TEXT,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "claimedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_claims_slackChannelId_key" ON "channel_claims"("slackChannelId");

-- CreateIndex
CREATE INDEX "channel_claims_accountId_idx" ON "channel_claims"("accountId");

-- CreateIndex
CREATE INDEX "channel_claims_workspaceId_idx" ON "channel_claims"("workspaceId");

-- AddForeignKey
ALTER TABLE "channel_claims" ADD CONSTRAINT "channel_claims_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_claims" ADD CONSTRAINT "channel_claims_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_claims" ADD CONSTRAINT "channel_claims_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
