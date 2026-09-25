-- CreateTable
CREATE TABLE "sales_readiness_items" (
    "id" TEXT NOT NULL,
    "maturityStage" TEXT NOT NULL,
    "capabilityCategory" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_readiness_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_readiness_account_items" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'to_do',
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_readiness_account_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_readiness_items_maturityStage_idx" ON "sales_readiness_items"("maturityStage");

-- CreateIndex
CREATE UNIQUE INDEX "sales_readiness_account_items_accountId_itemId_key" ON "sales_readiness_account_items"("accountId", "itemId");

-- CreateIndex
CREATE INDEX "sales_readiness_account_items_accountId_idx" ON "sales_readiness_account_items"("accountId");

-- AddForeignKey
ALTER TABLE "sales_readiness_account_items" ADD CONSTRAINT "sales_readiness_account_items_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_readiness_account_items" ADD CONSTRAINT "sales_readiness_account_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sales_readiness_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
