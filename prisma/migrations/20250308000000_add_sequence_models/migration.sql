-- CreateTable
CREATE TABLE "email_sequence_versions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salesNarrativeVersionId" TEXT NOT NULL,
    "firstCallChecklistVersionId" TEXT,
    "orgPersona" TEXT NOT NULL,
    "humanPersona" TEXT NOT NULL,
    "specialNotes" TEXT,
    "content" TEXT NOT NULL,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_sequence_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linkedin_sequence_versions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salesNarrativeVersionId" TEXT NOT NULL,
    "firstCallChecklistVersionId" TEXT,
    "orgPersona" TEXT NOT NULL,
    "humanPersona" TEXT NOT NULL,
    "specialNotes" TEXT,
    "content" TEXT NOT NULL,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linkedin_sequence_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_sequence_versions_userId_createdAt_idx" ON "email_sequence_versions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "linkedin_sequence_versions_userId_createdAt_idx" ON "linkedin_sequence_versions"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "email_sequence_versions" ADD CONSTRAINT "email_sequence_versions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sequence_versions" ADD CONSTRAINT "email_sequence_versions_salesNarrativeVersionId_fkey" FOREIGN KEY ("salesNarrativeVersionId") REFERENCES "sales_narrative_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sequence_versions" ADD CONSTRAINT "email_sequence_versions_firstCallChecklistVersionId_fkey" FOREIGN KEY ("firstCallChecklistVersionId") REFERENCES "first_call_checklist_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_sequence_versions" ADD CONSTRAINT "linkedin_sequence_versions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_sequence_versions" ADD CONSTRAINT "linkedin_sequence_versions_salesNarrativeVersionId_fkey" FOREIGN KEY ("salesNarrativeVersionId") REFERENCES "sales_narrative_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_sequence_versions" ADD CONSTRAINT "linkedin_sequence_versions_firstCallChecklistVersionId_fkey" FOREIGN KEY ("firstCallChecklistVersionId") REFERENCES "first_call_checklist_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
