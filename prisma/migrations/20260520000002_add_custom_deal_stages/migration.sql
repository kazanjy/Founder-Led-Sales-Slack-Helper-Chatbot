-- Per-account customizable deal pipeline stages. Built-in stages
-- (Prospecting, Discovery, Demo, Proposal, Negotiation, Closing,
-- Won, Lost) ship in the codebase; rows added here extend or
-- replace the pipeline for a single account.

CREATE TABLE "custom_deal_stages" (
  "id"        TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "color"     TEXT NOT NULL,
  "order"     INTEGER NOT NULL DEFAULT 0,
  "archived"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "custom_deal_stages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_deal_stages_account_value_unique"
  ON "custom_deal_stages"("accountId", "value");

CREATE INDEX "custom_deal_stages_account_archived_idx"
  ON "custom_deal_stages"("accountId", "archived");

ALTER TABLE "custom_deal_stages"
  ADD CONSTRAINT "custom_deal_stages_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
