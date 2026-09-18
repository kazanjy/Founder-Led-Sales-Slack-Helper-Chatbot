-- CreateEnum
CREATE TYPE "ObjectionCategory" AS ENUM ('NEED', 'PRIORITY', 'ROI', 'PRODUCT', 'COMPETITION', 'ADOPTION', 'BUDGET', 'TRUST', 'AUTHORITY');

-- CreateTable
CREATE TABLE "objection_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "objection" TEXT NOT NULL,
    "category" "ObjectionCategory" NOT NULL,
    "orgPersona" TEXT NOT NULL,
    "humanPersona" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'bootstrap',
    "conversationId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "objection_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objection_bootstraps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salesNarrativeVersionId" TEXT NOT NULL,
    "orgPersona" TEXT NOT NULL,
    "humanPersona" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "objection_bootstraps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "objection_entries_userId_category_idx" ON "objection_entries"("userId", "category");

-- CreateIndex
CREATE INDEX "objection_entries_userId_createdAt_idx" ON "objection_entries"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "objection_bootstraps_userId_createdAt_idx" ON "objection_bootstraps"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "objection_entries" ADD CONSTRAINT "objection_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objection_bootstraps" ADD CONSTRAINT "objection_bootstraps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objection_bootstraps" ADD CONSTRAINT "objection_bootstraps_salesNarrativeVersionId_fkey" FOREIGN KEY ("salesNarrativeVersionId") REFERENCES "sales_narrative_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
