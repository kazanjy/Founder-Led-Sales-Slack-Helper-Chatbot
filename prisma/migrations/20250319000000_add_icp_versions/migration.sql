-- CreateTable
CREATE TABLE "icp_versions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salesNarrativeVersionId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Ideal Customer Profile',
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "icp_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "icp_versions_userId_createdAt_idx" ON "icp_versions"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "icp_versions" ADD CONSTRAINT "icp_versions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icp_versions" ADD CONSTRAINT "icp_versions_salesNarrativeVersionId_fkey" FOREIGN KEY ("salesNarrativeVersionId") REFERENCES "sales_narrative_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
