ALTER TABLE "NewsArticle" ADD COLUMN "sourceTitle" TEXT;

UPDATE "NewsArticle"
SET "sourceTitle" = "title"
WHERE "sourceId" IS NOT NULL AND "sourceTitle" IS NULL;
