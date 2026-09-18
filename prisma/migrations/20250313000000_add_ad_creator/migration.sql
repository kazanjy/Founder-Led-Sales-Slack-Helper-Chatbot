-- CreateTable
CREATE TABLE "ad_creator_versions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salesNarrativeVersionId" TEXT NOT NULL,
    "firstCallChecklistVersionId" TEXT,
    "orgPersona" TEXT NOT NULL,
    "humanPersona" TEXT NOT NULL,
    "specialNotes" TEXT,
    "platforms" TEXT[],
    "content" TEXT NOT NULL,
    "iteratedFromId" TEXT,
    "iterationNotes" TEXT,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_creator_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ad_creator_versions_userId_createdAt_idx" ON "ad_creator_versions"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ad_creator_versions" ADD CONSTRAINT "ad_creator_versions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creator_versions" ADD CONSTRAINT "ad_creator_versions_salesNarrativeVersionId_fkey" FOREIGN KEY ("salesNarrativeVersionId") REFERENCES "sales_narrative_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creator_versions" ADD CONSTRAINT "ad_creator_versions_firstCallChecklistVersionId_fkey" FOREIGN KEY ("firstCallChecklistVersionId") REFERENCES "first_call_checklist_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creator_versions" ADD CONSTRAINT "ad_creator_versions_iteratedFromId_fkey" FOREIGN KEY ("iteratedFromId") REFERENCES "ad_creator_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
