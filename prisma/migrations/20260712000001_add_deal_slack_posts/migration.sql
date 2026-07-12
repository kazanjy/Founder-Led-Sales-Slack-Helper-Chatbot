-- CreateTable
CREATE TABLE "deal_slack_posts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "slackChannelId" TEXT NOT NULL,
    "slackTs" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_slack_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deal_slack_posts_dealId_kind_sourceRef_key" ON "deal_slack_posts"("dealId", "kind", "sourceRef");

-- CreateIndex
CREATE INDEX "deal_slack_posts_slackChannelId_slackTs_idx" ON "deal_slack_posts"("slackChannelId", "slackTs");

-- CreateIndex
CREATE INDEX "deal_slack_posts_userId_createdAt_idx" ON "deal_slack_posts"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "deal_slack_posts" ADD CONSTRAINT "deal_slack_posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_slack_posts" ADD CONSTRAINT "deal_slack_posts_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
