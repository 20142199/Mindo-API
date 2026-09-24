UPDATE "NewsSource"
SET "listingUrl" = CASE "key"
  WHEN 'yahoo_finance' THEN 'https://finance.yahoo.com/topic/stock-market-news/'
  WHEN 'world_bank' THEN 'https://www.worldbank.org/en/news'
  WHEN 'opec' THEN 'https://www.opec.org/'
  ELSE "listingUrl"
END,
"updatedAt" = CURRENT_TIMESTAMP
WHERE "key" IN ('yahoo_finance', 'world_bank', 'opec');
