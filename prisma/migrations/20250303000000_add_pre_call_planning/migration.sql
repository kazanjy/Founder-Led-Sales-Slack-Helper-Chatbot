-- CreateTable
CREATE TABLE "pre_call_planning_versions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstCallChecklistVersionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_call_planning_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_call_research" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT,
    "contactTitle" TEXT,
    "freeformInput" TEXT,
    "content" TEXT NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'web',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_call_research_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pre_call_planning_versions_userId_createdAt_idx" ON "pre_call_planning_versions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "pre_call_research_userId_createdAt_idx" ON "pre_call_research"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "pre_call_research_userId_companyName_idx" ON "pre_call_research"("userId", "companyName");

-- AddForeignKey
ALTER TABLE "pre_call_planning_versions" ADD CONSTRAINT "pre_call_planning_versions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_call_planning_versions" ADD CONSTRAINT "pre_call_planning_versions_firstCallChecklistVersionId_fkey" FOREIGN KEY ("firstCallChecklistVersionId") REFERENCES "first_call_checklist_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_call_research" ADD CONSTRAINT "pre_call_research_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
