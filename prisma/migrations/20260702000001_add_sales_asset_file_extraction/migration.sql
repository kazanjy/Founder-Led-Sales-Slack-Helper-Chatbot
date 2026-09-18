-- Extend SalesAssetVersion to hold uploaded file bytes + extracted
-- text so the collateral library can accept PDF/DOCX uploads (not
-- just external URLs) and expose the parsed content to the agent
-- via searchCollateral + getFullAccountContext.
--
-- All columns nullable — existing URL-only versions stay valid; the
-- new columns populate only when a version was uploaded (vs linked).
ALTER TABLE "sales_asset_versions"
  ADD COLUMN "fileStoragePath" TEXT,
  ADD COLUMN "fileMimeType" TEXT,
  ADD COLUMN "fileBytes" INTEGER,
  ADD COLUMN "extractedText" TEXT,
  ADD COLUMN "extractTextStatus" TEXT,
  ADD COLUMN "pageCount" INTEGER,
  ADD COLUMN "extractedAt" TIMESTAMP(3);
