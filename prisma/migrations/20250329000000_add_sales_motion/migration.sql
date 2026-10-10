CREATE TABLE "sales_motion_collections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Sales Motion Analysis',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "salesMotionSynthesis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_motion_collections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_motion_deals" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT,
    "outcome" TEXT,
    "dealOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_motion_deals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_motion_calls" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "summary" TEXT,
    "transcript" TEXT,
    "name" TEXT,
    "callType" TEXT,
    "callOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_motion_calls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_motion_call_scripts" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "callType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceCallCount" INTEGER NOT NULL DEFAULT 0,
    "iterationHistory" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_motion_call_scripts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sales_motion_collections_userId_createdAt_idx" ON "sales_motion_collections"("userId", "createdAt");
CREATE INDEX "sales_motion_deals_collectionId_idx" ON "sales_motion_deals"("collectionId");
CREATE INDEX "sales_motion_calls_dealId_idx" ON "sales_motion_calls"("dealId");
CREATE INDEX "sales_motion_call_scripts_collectionId_idx" ON "sales_motion_call_scripts"("collectionId");

ALTER TABLE "sales_motion_collections" ADD CONSTRAINT "sales_motion_collections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_motion_deals" ADD CONSTRAINT "sales_motion_deals_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "sales_motion_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_motion_calls" ADD CONSTRAINT "sales_motion_calls_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "sales_motion_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_motion_call_scripts" ADD CONSTRAINT "sales_motion_call_scripts_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "sales_motion_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
