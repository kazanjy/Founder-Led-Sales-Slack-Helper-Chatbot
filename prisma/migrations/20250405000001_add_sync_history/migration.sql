-- CreateTable
CREATE TABLE "sales_readiness_sync_history" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceContent" TEXT NOT NULL,
    "analysisResult" TEXT NOT NULL,
    "acceptedItemIds" TEXT NOT NULL,
    "stageAccepted" BOOLEAN NOT NULL DEFAULT false,
    "totalProposed" INTEGER NOT NULL DEFAULT 0,
    "totalAccepted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_readiness_sync_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_readiness_sync_history_accountId_createdAt_idx" ON "sales_readiness_sync_history"("accountId", "createdAt" DESC);
