ALTER TABLE "NewsArticle" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "NewsArticle_deletedAt_createdAt_idx" ON "NewsArticle"("deletedAt", "createdAt");
