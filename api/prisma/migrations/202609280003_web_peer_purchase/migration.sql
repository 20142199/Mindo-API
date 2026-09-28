ALTER TABLE "User"
ADD COLUMN "agencyTitle" TEXT,
ADD COLUMN "totalPackagesPurchased" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Deposit"
ADD COLUMN "expiresAt" TIMESTAMP(3);

ALTER TABLE "PurchaseOrder"
ADD COLUMN "grossTotalVnd" DECIMAL(20,0),
ADD COLUMN "discountVnd" DECIMAL(20,0),
ADD COLUMN "effectiveDiscountRate" DECIMAL(5,4),
ADD COLUMN "agencyTitle" TEXT,
ADD COLUMN "unitPriceUsd" DECIMAL(10,2),
ADD COLUMN "usdVndRate" DECIMAL(20,4),
ADD COLUMN "pricingBreakdown" JSONB,
ADD COLUMN "referralCode" TEXT;

CREATE INDEX "Deposit_status_expiresAt_idx" ON "Deposit"("status", "expiresAt");

ALTER TABLE "User"
ADD CONSTRAINT "User_totalPackagesPurchased_check" CHECK ("totalPackagesPurchased" >= 0),
ADD CONSTRAINT "User_agencyTitle_check" CHECK ("agencyTitle" IS NULL OR "agencyTitle" IN ('TIER_1', 'TIER_2', 'TIER_3'));

ALTER TABLE "PurchaseOrder"
ADD CONSTRAINT "PurchaseOrder_effectiveDiscountRate_check" CHECK (
  "effectiveDiscountRate" IS NULL OR ("effectiveDiscountRate" >= 0 AND "effectiveDiscountRate" <= 1)
),
ADD CONSTRAINT "PurchaseOrder_agencyTitle_check" CHECK (
  "agencyTitle" IS NULL OR "agencyTitle" IN ('TIER_1', 'TIER_2', 'TIER_3')
);

WITH totals AS (
  SELECT "userId", COALESCE(SUM("quantity"), 0)::INTEGER AS quantity
  FROM "PurchaseOrder"
  WHERE "status" = 'COMPLETED'
  GROUP BY "userId"
)
UPDATE "User" AS account
SET
  "totalPackagesPurchased" = totals.quantity,
  "agencyTitle" = CASE
    WHEN totals.quantity >= 200 THEN 'TIER_3'
    WHEN totals.quantity >= 50 THEN 'TIER_2'
    WHEN totals.quantity >= 1 THEN 'TIER_1'
    ELSE NULL
  END
FROM totals
WHERE account.id = totals."userId";

UPDATE "PurchaseOrder"
SET
  "grossTotalVnd" = "totalVnd",
  "discountVnd" = 0,
  "effectiveDiscountRate" = 0;
