-- CreateTable
CREATE TABLE "first_call_checklist_versions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "discoveryQuestionsVersionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "first_call_checklist_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "first_call_checklist_versions_userId_createdAt_idx" ON "first_call_checklist_versions"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "first_call_checklist_versions" ADD CONSTRAINT "first_call_checklist_versions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "first_call_checklist_versions" ADD CONSTRAINT "first_call_checklist_versions_discoveryQuestionsVersionId_fkey" FOREIGN KEY ("discoveryQuestionsVersionId") REFERENCES "discovery_questions_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
