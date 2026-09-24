CREATE TYPE "NewsCrawlStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

ALTER TABLE "NewsArticle"
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "externalKey" TEXT,
  ADD COLUMN "sourceAuthor" TEXT,
  ADD COLUMN "sourceContent" TEXT,
  ADD COLUMN "sourcePublishedAt" TIMESTAMP(3),
  ADD COLUMN "sourceFetchedAt" TIMESTAMP(3);

CREATE TABLE "NewsSource" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "listingUrl" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "crawlIntervalMinutes" INTEGER NOT NULL DEFAULT 120,
  "maxItemsPerRun" INTEGER NOT NULL DEFAULT 8,
  "topicId" TEXT,
  "lastCrawledAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsCrawlRun" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "status" "NewsCrawlStatus" NOT NULL DEFAULT 'RUNNING',
  "discovered" INTEGER NOT NULL DEFAULT 0,
  "imported" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "NewsCrawlRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsSource_key_key" ON "NewsSource"("key");
CREATE INDEX "NewsSource_isActive_lastCrawledAt_idx" ON "NewsSource"("isActive", "lastCrawledAt");
CREATE INDEX "NewsSource_topicId_idx" ON "NewsSource"("topicId");
CREATE INDEX "NewsCrawlRun_sourceId_startedAt_idx" ON "NewsCrawlRun"("sourceId", "startedAt");
CREATE INDEX "NewsCrawlRun_status_startedAt_idx" ON "NewsCrawlRun"("status", "startedAt");
CREATE UNIQUE INDEX "NewsArticle_sourceId_externalKey_key" ON "NewsArticle"("sourceId", "externalKey");
CREATE INDEX "NewsArticle_sourceId_sourcePublishedAt_idx" ON "NewsArticle"("sourceId", "sourcePublishedAt");

ALTER TABLE "NewsArticle" ADD CONSTRAINT "NewsArticle_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "NewsSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NewsSource" ADD CONSTRAINT "NewsSource_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "NewsTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NewsCrawlRun" ADD CONSTRAINT "NewsCrawlRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "NewsSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "NewsSource" ("id", "key", "name", "baseUrl", "listingUrl", "isActive", "crawlIntervalMinutes", "maxItemsPerRun", "updatedAt") VALUES
  ('newssrc_investing', 'investing', 'Investing.com', 'https://www.investing.com', 'https://www.investing.com/news/', true, 120, 8, CURRENT_TIMESTAMP),
  ('newssrc_forexfactory', 'forex_factory', 'Forex Factory', 'https://www.forexfactory.com', 'https://www.forexfactory.com/news', true, 120, 8, CURRENT_TIMESTAMP),
  ('newssrc_cme', 'cme_group', 'CME Group', 'https://www.cmegroup.com', 'https://www.cmegroup.com/news.html', true, 180, 8, CURRENT_TIMESTAMP),
  ('newssrc_ice', 'ice', 'ICE', 'https://www.ice.com', 'https://www.ice.com/insights', true, 180, 8, CURRENT_TIMESTAMP),
  ('newssrc_yahoo', 'yahoo_finance', 'Yahoo Finance', 'https://finance.yahoo.com', 'https://finance.yahoo.com/news/', true, 120, 8, CURRENT_TIMESTAMP),
  ('newssrc_fed', 'federal_reserve', 'Federal Reserve', 'https://www.federalreserve.gov', 'https://www.federalreserve.gov/newsevents/pressreleases.htm', true, 120, 8, CURRENT_TIMESTAMP),
  ('newssrc_ecb', 'ecb', 'European Central Bank', 'https://www.ecb.europa.eu', 'https://www.ecb.europa.eu/press/pr/date/html/index.en.html', true, 120, 8, CURRENT_TIMESTAMP),
  ('newssrc_imf', 'imf', 'International Monetary Fund', 'https://www.imf.org', 'https://www.imf.org/en/News', true, 180, 8, CURRENT_TIMESTAMP),
  ('newssrc_worldbank', 'world_bank', 'World Bank', 'https://www.worldbank.org', 'https://www.worldbank.org/en/news/all', true, 180, 8, CURRENT_TIMESTAMP),
  ('newssrc_opec', 'opec', 'OPEC', 'https://www.opec.org', 'https://www.opec.org/press-releases.html', true, 180, 8, CURRENT_TIMESTAMP);
