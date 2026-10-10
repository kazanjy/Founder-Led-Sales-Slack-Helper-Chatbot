-- CreateTable
CREATE TABLE "deal_analyses" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "analysis" TEXT NOT NULL,
    "stage" TEXT,
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deal_analyses_dealId_createdAt_idx" ON "deal_analyses"("dealId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "deal_analyses" ADD CONSTRAINT "deal_analyses_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
