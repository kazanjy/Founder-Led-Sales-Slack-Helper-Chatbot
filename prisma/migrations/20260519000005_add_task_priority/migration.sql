-- Optional P0 / P1 / P2 priority tag on coaching tasks (and
-- subtasks — same table). Nullable so existing tasks default to
-- unranked.

ALTER TABLE "coaching_tasks" ADD COLUMN "priority" TEXT;
