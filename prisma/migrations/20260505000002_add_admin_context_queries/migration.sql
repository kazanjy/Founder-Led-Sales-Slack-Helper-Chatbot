-- Audit trail for the admin "Ask This Account" feature: who queried
-- which account/user with what question. Stores a question preview
-- and structured stats only - never the answer or bundled context -
-- so the audit table doesn't itself become a customer-data leak
-- channel.

CREATE TABLE "admin_context_queries" (
  "id"               TEXT NOT NULL,
  "adminUserId"      TEXT NOT NULL,
  "scope"            TEXT NOT NULL,
  "targetId"         TEXT NOT NULL,
  "questionPreview"  TEXT NOT NULL,
  "itemCounts"       TEXT NOT NULL,
  "totalChars"       INTEGER NOT NULL DEFAULT 0,
  "truncations"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_context_queries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_context_queries_adminUserId_createdAt_idx"
  ON "admin_context_queries" ("adminUserId", "createdAt");

CREATE INDEX "admin_context_queries_scope_targetId_createdAt_idx"
  ON "admin_context_queries" ("scope", "targetId", "createdAt");

ALTER TABLE "admin_context_queries"
  ADD CONSTRAINT "admin_context_queries_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
