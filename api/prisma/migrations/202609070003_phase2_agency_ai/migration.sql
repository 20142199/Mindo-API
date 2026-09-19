CREATE TYPE "AgencyStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'LOCKED');
CREATE TYPE "AgencyPackageStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'CANCELLED');
CREATE TYPE "CommissionStatus" AS ENUM ('EARNED', 'PAID', 'CANCELLED');
CREATE TYPE "AiConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
CREATE TYPE "AiMessageKind" AS ENUM ('CHAT', 'IMAGE', 'DOCUMENT', 'TRANSLATION');
CREATE TYPE "AiMessageStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN "referredById" TEXT;
UPDATE "User" SET "referralCode" = substr(md5("id" || clock_timestamp()::text), 1, 25) WHERE "referralCode" IS NULL;
ALTER TABLE "User" ALTER COLUMN "referralCode" SET NOT NULL;

ALTER TABLE "PurchaseOrder" ADD COLUMN "agencyId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "commissionRate" DECIMAL(5,4);
ALTER TABLE "PurchaseOrder" ADD COLUMN "commissionVnd" DECIMAL(20,0);
ALTER TABLE "LedgerEntry" ADD COLUMN "commissionId" TEXT;

CREATE TABLE "Agency" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "businessName" TEXT NOT NULL,
  "taxCode" TEXT,
  "phone" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "status" "AgencyStatus" NOT NULL DEFAULT 'PENDING',
  "parentId" TEXT,
  "reviewNote" TEXT,
  "rejectionReason" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "lockedAt" TIMESTAMP(3),
  "totalRevenueVnd" DECIMAL(20,0) NOT NULL DEFAULT 0,
  "totalCommissionVnd" DECIMAL(20,0) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgencyStore" (
  "id" TEXT NOT NULL,
  "agencyId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "logoUrl" TEXT,
  "bannerUrl" TEXT,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "primaryColor" TEXT NOT NULL DEFAULT '#174EA6',
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgencyStore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgencyPackagePurchase" (
  "id" TEXT NOT NULL,
  "agencyId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "discountRate" DECIMAL(5,4) NOT NULL,
  "grossAmountVnd" DECIMAL(20,0) NOT NULL,
  "netAmountVnd" DECIMAL(20,0) NOT NULL,
  "commissionSlots" INTEGER NOT NULL,
  "remainingCommissionSlots" INTEGER NOT NULL,
  "status" "AgencyPackageStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgencyPackagePurchase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgencyCommission" (
  "id" TEXT NOT NULL,
  "agencyId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "buyerId" TEXT NOT NULL,
  "amountVnd" DECIMAL(20,0) NOT NULL,
  "rate" DECIMAL(5,4) NOT NULL,
  "status" "CommissionStatus" NOT NULL DEFAULT 'EARNED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMP(3),
  CONSTRAINT "AgencyCommission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgencyContract" (
  "id" TEXT NOT NULL,
  "agencyId" TEXT NOT NULL,
  "contractNumber" TEXT NOT NULL,
  "issuedById" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgencyContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiExpert" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "specialty" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "systemPrompt" TEXT NOT NULL,
  "capabilities" JSONB NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiExpert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiConversation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expertId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "AiConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" "AiMessageRole" NOT NULL,
  "kind" "AiMessageKind" NOT NULL DEFAULT 'CHAT',
  "status" "AiMessageStatus" NOT NULL DEFAULT 'COMPLETED',
  "content" TEXT NOT NULL,
  "attachmentUrl" TEXT,
  "metadata" JSONB,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
CREATE UNIQUE INDEX "Agency_userId_key" ON "Agency"("userId");
CREATE UNIQUE INDEX "Agency_code_key" ON "Agency"("code");
CREATE INDEX "Agency_status_createdAt_idx" ON "Agency"("status", "createdAt");
CREATE INDEX "Agency_parentId_idx" ON "Agency"("parentId");
CREATE UNIQUE INDEX "AgencyStore_agencyId_key" ON "AgencyStore"("agencyId");
CREATE UNIQUE INDEX "AgencyStore_slug_key" ON "AgencyStore"("slug");
CREATE INDEX "AgencyPackagePurchase_agencyId_status_createdAt_idx" ON "AgencyPackagePurchase"("agencyId", "status", "createdAt");
CREATE UNIQUE INDEX "AgencyCommission_orderId_key" ON "AgencyCommission"("orderId");
CREATE INDEX "AgencyCommission_agencyId_createdAt_idx" ON "AgencyCommission"("agencyId", "createdAt");
CREATE UNIQUE INDEX "AgencyContract_agencyId_key" ON "AgencyContract"("agencyId");
CREATE UNIQUE INDEX "AgencyContract_contractNumber_key" ON "AgencyContract"("contractNumber");
CREATE UNIQUE INDEX "AiExpert_slug_key" ON "AiExpert"("slug");
CREATE INDEX "AiConversation_userId_updatedAt_idx" ON "AiConversation"("userId", "updatedAt");
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");
CREATE UNIQUE INDEX "LedgerEntry_commissionId_key" ON "LedgerEntry"("commissionId");

ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgencyStore" ADD CONSTRAINT "AgencyStore_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgencyPackagePurchase" ADD CONSTRAINT "AgencyPackagePurchase_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgencyPackagePurchase" ADD CONSTRAINT "AgencyPackagePurchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "NftProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgencyCommission" ADD CONSTRAINT "AgencyCommission_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgencyCommission" ADD CONSTRAINT "AgencyCommission_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgencyCommission" ADD CONSTRAINT "AgencyCommission_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgencyContract" ADD CONSTRAINT "AgencyContract_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgencyContract" ADD CONSTRAINT "AgencyContract_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "AgencyCommission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "AiExpert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
