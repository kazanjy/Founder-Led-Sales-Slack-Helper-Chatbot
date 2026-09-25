-- Role-typed hiring profiles: AE, SDR, CSM.
--
-- The AE profile and the Sales Leader profile were built as two
-- separate parallel stacks. Adding SDR and CSM the same way would mean
-- four near-identical tables, seed scripts, route trees and pages to
-- keep in step, so instead the existing hiring-profile stack gains a
-- roleType discriminator and serves all three seats.
--
-- Everything already in the table is an AE profile, so the default
-- backfills existing rows correctly and current behaviour is unchanged
-- until a second role is seeded.

ALTER TABLE "hiring_profile_questions"
  ADD COLUMN "roleType" TEXT NOT NULL DEFAULT 'AE';

ALTER TABLE "hiring_profile_versions"
  ADD COLUMN "roleType" TEXT NOT NULL DEFAULT 'AE';

-- globalOrder was globally unique, which allowed exactly one question
-- bank. Each role needs to number its own questions from 1, so the
-- constraint becomes composite.
ALTER TABLE "hiring_profile_questions"
  DROP CONSTRAINT IF EXISTS "hiring_profile_questions_globalOrder_key";

CREATE UNIQUE INDEX "hiring_profile_questions_roleType_globalOrder_key"
  ON "hiring_profile_questions" ("roleType", "globalOrder");

CREATE INDEX "hiring_profile_questions_roleType_globalOrder_idx"
  ON "hiring_profile_questions" ("roleType", "globalOrder");

-- The assessor looks up "latest profile for this account and seat".
CREATE INDEX "hiring_profile_versions_userId_roleType_createdAt_idx"
  ON "hiring_profile_versions" ("userId", "roleType", "createdAt");
