-- Persist candidate sourcing: saved searches, their result sets, and
-- whatever enrichment has been bought for each lead.
--
-- Sourcing previously held everything in page state, so a refresh threw
-- away the imported companies, the leads AND the enrichment credits
-- already spent on them. Persisting makes a search addressable at
-- /sourcing/<id> — bookmarkable, shareable, and returnable-to.
--
-- Safe to re-run: guarded DDL throughout.

BEGIN;

CREATE TABLE IF NOT EXISTS "sourcing_searches" (
  "id"         TEXT PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "name"       TEXT,
  "roleType"   TEXT NOT NULL DEFAULT 'AE',
  -- Criteria, not just results: a search worth keeping is usually one
  -- worth re-running, and the filters cannot be re-derived from a list
  -- of people.
  "companies"  JSONB NOT NULL,
  "titles"     JSONB NOT NULL,
  "locations"  JSONB NOT NULL,
  "modes"      JSONB NOT NULL,
  "yoeMin"     INTEGER,
  "yoeMax"     INTEGER,
  -- Apollo's match count at run time, usually larger than the page of
  -- leads actually stored.
  "totalFound" INTEGER NOT NULL DEFAULT 0,
  "lastRunAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sourcing_searches_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "sourcing_searches_userId_createdAt_idx"
  ON "sourcing_searches" ("userId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "sourcing_leads" (
  "id"               TEXT PRIMARY KEY,
  "searchId"         TEXT NOT NULL,
  -- Denormalized so lead queries can be scoped without a join.
  "userId"           TEXT NOT NULL,
  -- Apollo's person id: the only durable handle a search result has.
  "apolloId"         TEXT NOT NULL,
  "firstName"        TEXT,
  -- Apollo masks surnames in search results until enrichment.
  "lastNameMasked"   TEXT,
  "title"            TEXT,
  "organizationName" TEXT,
  "via"              JSONB,
  -- Enrichment. Null until a credit is spent; stored so it never is twice.
  "enrichedAt"       TIMESTAMP(3),
  "name"             TEXT,
  "linkedinUrl"      TEXT,
  "headline"         TEXT,
  "employers"        JSONB,
  "shortStints"      INTEGER,
  "tenureVerdict"    TEXT,
  "status"           TEXT NOT NULL DEFAULT 'new',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sourcing_leads_searchId_fkey"
    FOREIGN KEY ("searchId") REFERENCES "sourcing_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- A person appears once per search, so re-running merges rather than
-- duplicating — and keeps the enrichment already paid for.
CREATE UNIQUE INDEX IF NOT EXISTS "sourcing_leads_searchId_apolloId_key"
  ON "sourcing_leads" ("searchId", "apolloId");
CREATE INDEX IF NOT EXISTS "sourcing_leads_userId_idx"
  ON "sourcing_leads" ("userId");
CREATE INDEX IF NOT EXISTS "sourcing_leads_searchId_status_idx"
  ON "sourcing_leads" ("searchId", "status");

COMMIT;
