CREATE TYPE "NewsEditorialStatus" AS ENUM ('NOT_REQUESTED', 'PROCESSING', 'READY', 'FAILED');

ALTER TABLE "NewsArticle"
ADD COLUMN "aiEditorialStatus" "NewsEditorialStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
ADD COLUMN "aiEditorialError" TEXT,
ADD COLUMN "aiEditorialModel" TEXT,
ADD COLUMN "aiEditorialInputTokens" INTEGER,
ADD COLUMN "aiEditorialOutputTokens" INTEGER,
ADD COLUMN "aiEditorialTotalTokens" INTEGER,
ADD COLUMN "aiEditorialAt" TIMESTAMP(3);

UPDATE "NewsArticle"
SET "aiEditorialStatus" = 'READY',
    "aiEditorialAt" = "updatedAt"
WHERE "sourceContent" IS NOT NULL
  AND LENGTH(TRIM("content")) > 0;

CREATE INDEX "NewsArticle_aiEditorialStatus_createdAt_idx" ON "NewsArticle"("aiEditorialStatus", "createdAt");

UPDATE "NewsSource"
SET "lastError" = NULL
WHERE "lastError" LIKE 'AI:%'
   OR "lastError" LIKE '%[AI]%';
