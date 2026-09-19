-- Record acceptance of the terms shown on the Mindo registration screen.
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);

-- A verified reset OTP is exchanged for a short-lived, single-use token.
CREATE TABLE "PasswordResetTicket" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetTicket_tokenHash_key" ON "PasswordResetTicket"("tokenHash");
CREATE INDEX "PasswordResetTicket_userId_expiresAt_idx" ON "PasswordResetTicket"("userId", "expiresAt");
ALTER TABLE "PasswordResetTicket" ADD CONSTRAINT "PasswordResetTicket_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
