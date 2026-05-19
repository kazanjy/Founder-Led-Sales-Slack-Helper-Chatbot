-- Saved patterns the daily cron uses to auto-research recurring
-- calendar meetings and post the brief to Slack on the user's
-- behalf. Each pattern is a substring matched against the event
-- title; matches generate a brief and broadcast it to either the
-- user's MikeyBot DM or a specific channel.

CREATE TABLE "recurring_research_patterns" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "titlePattern" TEXT NOT NULL,
  "destination"  TEXT NOT NULL,
  "channelId"    TEXT,
  "channelName"  TEXT,
  "enabled"      BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt"    TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recurring_research_patterns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recurring_research_patterns_userId_enabled_idx"
  ON "recurring_research_patterns"("userId", "enabled");

ALTER TABLE "recurring_research_patterns"
  ADD CONSTRAINT "recurring_research_patterns_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tracks each (pattern, calendar event) the cron has already
-- handled so we don't re-process / re-post the same brief on later
-- runs.

CREATE TABLE "recurring_research_runs" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "patternId"       TEXT NOT NULL,
  "calendarEventId" TEXT NOT NULL,
  "status"          TEXT NOT NULL,
  "researchId"      TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "recurring_research_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recurring_research_runs_pattern_event_unique"
  ON "recurring_research_runs"("patternId", "calendarEventId");

CREATE INDEX "recurring_research_runs_user_createdAt_idx"
  ON "recurring_research_runs"("userId", "createdAt");
