-- AlterEnum
ALTER TYPE "NewsFeedbackType" ADD VALUE 'HIDE_SOURCE';

-- AlterTable
ALTER TABLE "NewsArticleFeedback" ADD COLUMN     "sourceId" TEXT;

-- CreateTable
CREATE TABLE "NewsAiSummaryUnlock" (
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsAiSummaryUnlock_pkey" PRIMARY KEY ("userId","articleId")
);

-- CreateIndex
CREATE INDEX "NewsAiSummaryUnlock_userId_createdAt_idx" ON "NewsAiSummaryUnlock"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "NewsAiSummaryUnlock_articleId_idx" ON "NewsAiSummaryUnlock"("articleId");

-- CreateIndex
CREATE INDEX "NewsArticleFeedback_sourceId_idx" ON "NewsArticleFeedback"("sourceId");

-- AddForeignKey
ALTER TABLE "NewsArticleFeedback" ADD CONSTRAINT "NewsArticleFeedback_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "NewsSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsAiSummaryUnlock" ADD CONSTRAINT "NewsAiSummaryUnlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsAiSummaryUnlock" ADD CONSTRAINT "NewsAiSummaryUnlock_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

