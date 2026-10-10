-- One-level subtasks on coaching tasks. The depth-1 cap (a subtask
-- can't have its own subtask) is enforced at the API layer, not via a
-- DB constraint — Postgres has no native way to express that without
-- a recursive trigger.

ALTER TABLE "coaching_tasks" ADD COLUMN "parentTaskId" TEXT;

CREATE INDEX "coaching_tasks_parentTaskId_idx"
  ON "coaching_tasks"("parentTaskId");

ALTER TABLE "coaching_tasks"
  ADD CONSTRAINT "coaching_tasks_parentTaskId_fkey"
  FOREIGN KEY ("parentTaskId") REFERENCES "coaching_tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
