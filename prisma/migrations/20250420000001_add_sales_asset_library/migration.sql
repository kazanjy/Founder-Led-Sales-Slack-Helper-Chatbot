-- CreateTable
CREATE TABLE "sales_assets" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "slotKey" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "currentUrl" TEXT,
    "currentLabel" TEXT,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_asset_versions" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_asset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_assets_accountId_idx" ON "sales_assets"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_assets_accountId_slotKey_key" ON "sales_assets"("accountId", "slotKey");

-- CreateIndex
CREATE INDEX "sales_asset_versions_assetId_createdAt_idx" ON "sales_asset_versions"("assetId", "createdAt");

-- AddForeignKey
ALTER TABLE "sales_assets" ADD CONSTRAINT "sales_assets_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_asset_versions" ADD CONSTRAINT "sales_asset_versions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "sales_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_asset_versions" ADD CONSTRAINT "sales_asset_versions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
