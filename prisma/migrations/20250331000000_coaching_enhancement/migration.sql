-- Extend CoachingSession with session lifecycle and maturity stage snapshot
ALTER TABLE "coaching_sessions" ADD COLUMN "sessionStatus" TEXT NOT NULL DEFAULT 'new';
ALTER TABLE "coaching_sessions" ADD COLUMN "maturityStage" TEXT;

-- Create SalesMaturityStage (per-user singleton)
CREATE TABLE "sales_maturity_stages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentStage" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_maturity_stages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_maturity_stages_userId_key" ON "sales_maturity_stages"("userId");

ALTER TABLE "sales_maturity_stages" ADD CONSTRAINT "sales_maturity_stages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create CoachingGoal
CREATE TABLE "coaching_goals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "statusChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "coaching_goals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "coaching_goals_userId_status_idx" ON "coaching_goals"("userId", "status");
CREATE INDEX "coaching_goals_sessionId_idx" ON "coaching_goals"("sessionId");

ALTER TABLE "coaching_goals" ADD CONSTRAINT "coaching_goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coaching_goals" ADD CONSTRAINT "coaching_goals_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "coaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create CoachingTask
CREATE TABLE "coaching_tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "statusChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "coaching_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "coaching_tasks_goalId_idx" ON "coaching_tasks"("goalId");

ALTER TABLE "coaching_tasks" ADD CONSTRAINT "coaching_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coaching_tasks" ADD CONSTRAINT "coaching_tasks_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "coaching_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create CoachingMetricDefinition
CREATE TABLE "coaching_metric_definitions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" TEXT,
    "interval" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coaching_metric_definitions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "coaching_metric_definitions_userId_idx" ON "coaching_metric_definitions"("userId");

ALTER TABLE "coaching_metric_definitions" ADD CONSTRAINT "coaching_metric_definitions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create CoachingMetricEntry
CREATE TABLE "coaching_metric_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metricDefinitionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "currentValue" DOUBLE PRECISION NOT NULL,
    "addedSinceLastSession" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coaching_metric_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "coaching_metric_entries_sessionId_idx" ON "coaching_metric_entries"("sessionId");
CREATE INDEX "coaching_metric_entries_metricDefinitionId_idx" ON "coaching_metric_entries"("metricDefinitionId");

ALTER TABLE "coaching_metric_entries" ADD CONSTRAINT "coaching_metric_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coaching_metric_entries" ADD CONSTRAINT "coaching_metric_entries_metricDefinitionId_fkey" FOREIGN KEY ("metricDefinitionId") REFERENCES "coaching_metric_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coaching_metric_entries" ADD CONSTRAINT "coaching_metric_entries_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "coaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
