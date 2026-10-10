-- Bookkeeping for the hourly call-recorder scanner. One row per
-- (user, providerCallId) so re-runs short-circuit without
-- reprocessing the same recording.

CREATE TABLE "processed_recordings" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "provider"       TEXT NOT NULL,
  "providerCallId" TEXT NOT NULL,
  "result"         TEXT NOT NULL,
  "dealId"         TEXT,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "processed_recordings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "processed_recordings_user_call_unique"
  ON "processed_recordings"("userId", "providerCallId");

CREATE INDEX "processed_recordings_user_createdAt_idx"
  ON "processed_recordings"("userId", "createdAt");

ALTER TABLE "processed_recordings"
  ADD CONSTRAINT "processed_recordings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
