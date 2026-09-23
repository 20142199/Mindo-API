ALTER TABLE "Agency"
ADD COLUMN "title" TEXT,
ADD COLUMN "totalPackagesPurchased" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "discountRate" DECIMAL(5,4) NOT NULL DEFAULT 0;

ALTER TABLE "AgencyPackagePurchase"
ADD COLUMN "unitPriceUsd" DECIMAL(10,2) NOT NULL DEFAULT 25,
ADD COLUMN "usdVndRate" DECIMAL(20,4) NOT NULL DEFAULT 25000,
ADD COLUMN "unitPriceVnd" DECIMAL(20,0) NOT NULL DEFAULT 625000,
ADD COLUMN "startingPackageNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "endingPackageNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "effectiveDiscountRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
ADD COLUMN "pricingBreakdown" JSONB;

UPDATE "AgencyPackagePurchase"
SET
  "unitPriceVnd" = CASE WHEN "quantity" > 0 THEN ROUND("grossAmountVnd" / "quantity") ELSE 0 END,
  "usdVndRate" = CASE WHEN "quantity" > 0 THEN ROUND(("grossAmountVnd" / "quantity") / 25, 4) ELSE 25000 END,
  "startingPackageNumber" = 1,
  "endingPackageNumber" = GREATEST("quantity", 1),
  "effectiveDiscountRate" = CASE
    WHEN "grossAmountVnd" > 0 THEN GREATEST(0, LEAST(1, ROUND(1 - ("netAmountVnd" / "grossAmountVnd"), 4)))
    ELSE 0
  END;

WITH package_totals AS (
  SELECT "agencyId", COALESCE(SUM("quantity"), 0)::INTEGER AS total
  FROM "AgencyPackagePurchase"
  GROUP BY "agencyId"
)
UPDATE "Agency" AS agency
SET
  "totalPackagesPurchased" = totals.total,
  "title" = CASE
    WHEN totals.total >= 200 THEN 'TIER_3'
    WHEN totals.total >= 50 THEN 'TIER_2'
    WHEN totals.total >= 1 THEN 'TIER_1'
    ELSE NULL
  END,
  "discountRate" = CASE
    WHEN totals.total >= 200 THEN 0.40
    WHEN totals.total >= 50 THEN 0.30
    WHEN totals.total >= 1 THEN 0.20
    ELSE 0
  END
FROM package_totals AS totals
WHERE agency.id = totals."agencyId";

UPDATE "AgencyPackagePurchase"
SET "status" = 'ACTIVE'
WHERE "status" = 'CANCELLED' AND "remainingCommissionSlots" > 0;

CREATE TABLE "AgencyPackageSetting" (
  "id" TEXT NOT NULL,
  "basePriceUsd" DECIMAL(10,2) NOT NULL DEFAULT 25,
  "usdVndRate" DECIMAL(20,4) NOT NULL DEFAULT 25000,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgencyPackageSetting_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgencyPackagePurchase_productId_idx" ON "AgencyPackagePurchase"("productId");
CREATE INDEX "AgencyPackageSetting_updatedById_idx" ON "AgencyPackageSetting"("updatedById");

ALTER TABLE "AgencyPackageSetting"
ADD CONSTRAINT "AgencyPackageSetting_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Agency"
ADD CONSTRAINT "Agency_totalPackagesPurchased_check" CHECK ("totalPackagesPurchased" >= 0),
ADD CONSTRAINT "Agency_discountRate_check" CHECK ("discountRate" >= 0 AND "discountRate" <= 1),
ADD CONSTRAINT "Agency_title_check" CHECK ("title" IS NULL OR "title" IN ('TIER_1', 'TIER_2', 'TIER_3'));

ALTER TABLE "AgencyPackagePurchase"
ADD CONSTRAINT "AgencyPackagePurchase_packageRange_check" CHECK (
  "startingPackageNumber" >= 1 AND "endingPackageNumber" >= "startingPackageNumber"
),
ADD CONSTRAINT "AgencyPackagePurchase_effectiveDiscountRate_check" CHECK (
  "effectiveDiscountRate" >= 0 AND "effectiveDiscountRate" <= 1
);

ALTER TABLE "AgencyPackageSetting"
ADD CONSTRAINT "AgencyPackageSetting_prices_check" CHECK ("basePriceUsd" > 0 AND "usdVndRate" > 0);

INSERT INTO "AgencyPackageSetting" ("id", "basePriceUsd", "usdVndRate", "updatedAt")
VALUES ('default', 25, 25000, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
