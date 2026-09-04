-- Future-dated deal tasks with one-touch Slack execution.
-- Additive — safe to apply to prod directly.
CREATE TABLE "deal_tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "dueAt" TIMESTAMP(3),
    "executeVia" TEXT,
    "draftMessage" TEXT,
    "proofEntryId" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "deal_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deal_tasks_userId_status_dueAt_idx" ON "deal_tasks"("userId", "status", "dueAt");
CREATE INDEX "deal_tasks_dealId_status_idx" ON "deal_tasks"("dealId", "status");

ALTER TABLE "deal_tasks" ADD CONSTRAINT "deal_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_tasks" ADD CONSTRAINT "deal_tasks_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
