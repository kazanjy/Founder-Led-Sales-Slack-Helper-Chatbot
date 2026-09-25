-- Practice suite: drill sessions with snapshotted synthetic personas.
-- Additive — safe to apply to prod directly.

CREATE TABLE "practice_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "drill" TEXT NOT NULL,
    "mode" TEXT,
    "persona" JSONB NOT NULL,
    "turns" JSONB,
    "answers" JSONB,
    "score" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "dealId" TEXT,
    "meetingEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "practice_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "practice_sessions_userId_drill_createdAt_idx" ON "practice_sessions"("userId", "drill", "createdAt" DESC);

ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
