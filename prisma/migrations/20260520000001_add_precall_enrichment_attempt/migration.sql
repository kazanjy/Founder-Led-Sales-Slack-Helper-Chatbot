-- Persist PDL enrichment attempts so Upcoming-calls tiles can show
-- "we tried, PDL had no record" across page refreshes rather than
-- looking like fresh, untouched events. One row per (user,
-- calendar event); upserted by /api/google-calendar/enrich-event.

CREATE TABLE "pre_call_enrichment_attempts" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "calendarEventId" TEXT NOT NULL,
  "pdlHits"         INTEGER NOT NULL DEFAULT 0,
  "total"           INTEGER NOT NULL DEFAULT 0,
  "companyFallback" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "pre_call_enrichment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pre_call_enrichment_attempts_user_event_unique"
  ON "pre_call_enrichment_attempts"("userId", "calendarEventId");

CREATE INDEX "pre_call_enrichment_attempts_user_createdAt_idx"
  ON "pre_call_enrichment_attempts"("userId", "createdAt");

ALTER TABLE "pre_call_enrichment_attempts"
  ADD CONSTRAINT "pre_call_enrichment_attempts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
