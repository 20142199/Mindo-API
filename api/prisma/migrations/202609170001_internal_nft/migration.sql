-- NFT ownership is now issued and tracked entirely inside Mindo.
ALTER TYPE "OrderStatus" RENAME VALUE 'CHAIN_PENDING' TO 'PENDING';
ALTER TYPE "OrderStatus" RENAME VALUE 'CHAIN_FAILED' TO 'FAILED';

ALTER TABLE "User" DROP COLUMN "walletAddress";

ALTER TABLE "NftProduct" RENAME COLUMN "tokenBaseUri" TO "metadataBaseUrl";
ALTER TABLE "NftProduct" DROP COLUMN "reservedCount";

ALTER TABLE "PurchaseOrder" DROP COLUMN "walletAddress";
ALTER TABLE "PurchaseOrder" DROP COLUMN "txHash";
ALTER TABLE "PurchaseOrder" DROP COLUMN "chainError";

ALTER TABLE "NftAsset" RENAME COLUMN "tokenId" TO "assetCode";
ALTER TABLE "NftAsset" RENAME COLUMN "tokenUri" TO "metadataUrl";
ALTER TABLE "NftAsset" RENAME COLUMN "mintedAt" TO "issuedAt";
ALTER TABLE "NftAsset" DROP COLUMN "txHash";

ALTER INDEX "NftAsset_tokenId_key" RENAME TO "NftAsset_assetCode_key";
CREATE INDEX "NftAsset_ownerId_issuedAt_idx" ON "NftAsset"("ownerId", "issuedAt");
