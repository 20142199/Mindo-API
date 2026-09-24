CREATE TYPE "NewsContentType" AS ENUM ('ARTICLE', 'WAVE');
CREATE TYPE "NewsFeedbackType" AS ENUM ('NOT_INTERESTED', 'HIDE_TOPIC', 'REPORT');

ALTER TABLE "NewsArticle"
  ADD COLUMN "videoUrl" TEXT,
  ADD COLUMN "contentType" "NewsContentType" NOT NULL DEFAULT 'ARTICLE',
  ADD COLUMN "topicId" TEXT,
  ADD COLUMN "expertId" TEXT;

CREATE TABLE "NewsTopic" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsTopic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsExpert" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "specialty" TEXT NOT NULL,
  "bio" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "coverUrl" TEXT,
  "initials" TEXT NOT NULL,
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsExpert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsExpertFollow" (
  "userId" TEXT NOT NULL,
  "expertId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsExpertFollow_pkey" PRIMARY KEY ("userId", "expertId")
);

CREATE TABLE "NewsUserInterest" (
  "userId" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsUserInterest_pkey" PRIMARY KEY ("userId", "topicId")
);

CREATE TABLE "NewsArticleLike" (
  "userId" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsArticleLike_pkey" PRIMARY KEY ("userId", "articleId")
);

CREATE TABLE "NewsArticleFeedback" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "topicId" TEXT,
  "type" "NewsFeedbackType" NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsArticleFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsTopic_slug_key" ON "NewsTopic"("slug");
CREATE INDEX "NewsTopic_isActive_sortOrder_idx" ON "NewsTopic"("isActive", "sortOrder");
CREATE UNIQUE INDEX "NewsExpert_slug_key" ON "NewsExpert"("slug");
CREATE INDEX "NewsExpert_isActive_sortOrder_idx" ON "NewsExpert"("isActive", "sortOrder");
CREATE INDEX "NewsExpertFollow_expertId_createdAt_idx" ON "NewsExpertFollow"("expertId", "createdAt");
CREATE INDEX "NewsUserInterest_topicId_idx" ON "NewsUserInterest"("topicId");
CREATE INDEX "NewsArticleLike_articleId_createdAt_idx" ON "NewsArticleLike"("articleId", "createdAt");
CREATE UNIQUE INDEX "NewsArticleFeedback_userId_articleId_type_key" ON "NewsArticleFeedback"("userId", "articleId", "type");
CREATE INDEX "NewsArticleFeedback_articleId_type_idx" ON "NewsArticleFeedback"("articleId", "type");
CREATE INDEX "NewsArticleFeedback_userId_type_createdAt_idx" ON "NewsArticleFeedback"("userId", "type", "createdAt");
CREATE INDEX "NewsArticle_topicId_status_publishedAt_idx" ON "NewsArticle"("topicId", "status", "publishedAt");
CREATE INDEX "NewsArticle_expertId_status_publishedAt_idx" ON "NewsArticle"("expertId", "status", "publishedAt");
CREATE INDEX "NewsArticle_contentType_status_publishedAt_idx" ON "NewsArticle"("contentType", "status", "publishedAt");

ALTER TABLE "NewsArticle" ADD CONSTRAINT "NewsArticle_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "NewsTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NewsArticle" ADD CONSTRAINT "NewsArticle_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "NewsExpert"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NewsExpertFollow" ADD CONSTRAINT "NewsExpertFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsExpertFollow" ADD CONSTRAINT "NewsExpertFollow_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "NewsExpert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsUserInterest" ADD CONSTRAINT "NewsUserInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsUserInterest" ADD CONSTRAINT "NewsUserInterest_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "NewsTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsArticleLike" ADD CONSTRAINT "NewsArticleLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsArticleLike" ADD CONSTRAINT "NewsArticleLike_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsArticleFeedback" ADD CONSTRAINT "NewsArticleFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsArticleFeedback" ADD CONSTRAINT "NewsArticleFeedback_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsArticleFeedback" ADD CONSTRAINT "NewsArticleFeedback_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "NewsTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
