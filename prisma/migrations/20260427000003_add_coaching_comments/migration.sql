-- Inline comment thread on coaching tasks.

CREATE TABLE "coaching_comments" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "editedAt"  TIMESTAMP(3),

  CONSTRAINT "coaching_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "coaching_comments_taskId_createdAt_idx"
  ON "coaching_comments"("taskId", "createdAt");

ALTER TABLE "coaching_comments"
  ADD CONSTRAINT "coaching_comments_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "coaching_tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coaching_comments"
  ADD CONSTRAINT "coaching_comments_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
