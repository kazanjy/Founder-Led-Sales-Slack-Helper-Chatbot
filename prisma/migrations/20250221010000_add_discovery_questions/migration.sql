-- CreateTable
CREATE TABLE "discovery_questions_versions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salesNarrativeVersionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_questions_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovery_questions_versions_userId_createdAt_idx" ON "discovery_questions_versions"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "discovery_questions_versions" ADD CONSTRAINT "discovery_questions_versions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_questions_versions" ADD CONSTRAINT "discovery_questions_versions_salesNarrativeVersionId_fkey" FOREIGN KEY ("salesNarrativeVersionId") REFERENCES "sales_narrative_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
