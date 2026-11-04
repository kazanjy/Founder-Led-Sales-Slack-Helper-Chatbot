CREATE TABLE "call_recap_versions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recordingUrl" TEXT NOT NULL,
    "callSummary" TEXT NOT NULL,
    "callTranscript" TEXT,
    "customNotes" TEXT,
    "title" TEXT NOT NULL,
    "callType" TEXT NOT NULL,
    "emailSubject" TEXT NOT NULL,
    "emailBody" TEXT NOT NULL,
    "iterationHistory" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "call_recap_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "call_recap_versions_userId_createdAt_idx" ON "call_recap_versions"("userId", "createdAt");

ALTER TABLE "call_recap_versions" ADD CONSTRAINT "call_recap_versions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
