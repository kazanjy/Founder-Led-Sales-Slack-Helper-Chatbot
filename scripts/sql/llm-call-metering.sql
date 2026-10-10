-- Per-call LLM metering.
--
-- Every OpenAI call in the app goes through one client instance, so
-- wrapping that records all 112 call sites without touching any.
--
-- Tokens are the durable record; cost is derived. Prices change and get
-- corrected, so costUsd is stored for cheap aggregation but
-- priceVersion says which table produced it — recompute from tokens
-- rather than trusting an old number.
--
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS "llm_calls" (
  "id"               TEXT PRIMARY KEY,
  -- Which feature made the call. Derived from the call stack, so it can
  -- be 'unknown'; an explicit label at the call site always wins.
  "label"            TEXT NOT NULL,
  "model"            TEXT NOT NULL,
  -- Straight from the API's usage block, never estimated.
  "promptTokens"     INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  -- Subset of promptTokens served from the prompt cache: far cheaper,
  -- and large for callers that re-send the same context repeatedly.
  "cachedTokens"     INTEGER NOT NULL DEFAULT 0,
  "totalTokens"      INTEGER NOT NULL DEFAULT 0,
  "costUsd"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "priceVersion"     TEXT NOT NULL DEFAULT 'v1',
  "durationMs"       INTEGER NOT NULL DEFAULT 0,
  "streamed"         BOOLEAN NOT NULL DEFAULT false,
  "ok"               BOOLEAN NOT NULL DEFAULT true,
  -- Timeouts and failures still bill for input while returning nothing.
  "errorKind"        TEXT,
  -- Best effort: unavailable on cron paths acting for many users.
  "userId"           TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- No FK to users: metering must never fail a call, and a cron row may
-- carry no user at all.
CREATE INDEX IF NOT EXISTS "llm_calls_createdAt_idx"       ON "llm_calls" ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "llm_calls_label_createdAt_idx" ON "llm_calls" ("label", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "llm_calls_model_createdAt_idx" ON "llm_calls" ("model", "createdAt" DESC);

COMMIT;
