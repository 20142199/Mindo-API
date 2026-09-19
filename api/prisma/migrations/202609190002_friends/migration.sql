ALTER TABLE "User" ADD COLUMN "phoneNormalized" TEXT;

WITH normalized AS (
  SELECT
    "id",
    CASE
      WHEN digits LIKE '0084%' THEN '0' || SUBSTRING(digits FROM 5)
      WHEN digits LIKE '84%' THEN '0' || SUBSTRING(digits FROM 3)
      ELSE digits
    END AS phone_normalized
  FROM (
    SELECT "id", REGEXP_REPLACE(COALESCE("phone", ''), '[^0-9]', '', 'g') AS digits
    FROM "User"
    WHERE "phone" IS NOT NULL
  ) phones
)
UPDATE "User" AS users
SET "phoneNormalized" = normalized.phone_normalized
FROM normalized
WHERE users."id" = normalized."id" AND normalized.phone_normalized <> '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "phoneNormalized" IS NOT NULL
    GROUP BY "phoneNormalized"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate normalized phone numbers must be resolved before enabling friend lookup';
  END IF;
END $$;

CREATE UNIQUE INDEX "User_phoneNormalized_key" ON "User"("phoneNormalized");

CREATE TABLE "FriendRequest" (
  "requesterId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FriendRequest_pkey" PRIMARY KEY ("requesterId", "recipientId"),
  CONSTRAINT "FriendRequest_different_users_check" CHECK ("requesterId" <> "recipientId")
);

CREATE TABLE "Friendship" (
  "userId" TEXT NOT NULL,
  "friendUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Friendship_pkey" PRIMARY KEY ("userId", "friendUserId"),
  CONSTRAINT "Friendship_different_users_check" CHECK ("userId" <> "friendUserId")
);

CREATE INDEX "FriendRequest_recipientId_createdAt_idx" ON "FriendRequest"("recipientId", "createdAt");
CREATE INDEX "FriendRequest_requesterId_createdAt_idx" ON "FriendRequest"("requesterId", "createdAt");
CREATE INDEX "Friendship_friendUserId_idx" ON "Friendship"("friendUserId");
CREATE INDEX "Friendship_userId_createdAt_idx" ON "Friendship"("userId", "createdAt");

ALTER TABLE "FriendRequest"
  ADD CONSTRAINT "FriendRequest_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FriendRequest"
  ADD CONSTRAINT "FriendRequest_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Friendship"
  ADD CONSTRAINT "Friendship_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Friendship"
  ADD CONSTRAINT "Friendship_friendUserId_fkey"
  FOREIGN KEY ("friendUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
