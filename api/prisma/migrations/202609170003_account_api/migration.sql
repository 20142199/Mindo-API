-- Account profile and preferences shown in the Mindo account screens.
ALTER TABLE "User"
    ADD COLUMN "address" TEXT,
    ADD COLUMN "avatarFileId" TEXT,
    ADD COLUMN "bankAccountName" TEXT,
    ADD COLUMN "bankAccountNumber" TEXT,
    ADD COLUMN "bankName" TEXT,
    ADD COLUMN "language" TEXT NOT NULL DEFAULT 'vi',
    ADD COLUMN "suspiciousLoginAlerts" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "loginRateLimitEnabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "inAppNotifications" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "loginLockedUntil" TIMESTAMP(3);

-- Session metadata lets the app display and revoke signed-in devices.
ALTER TABLE "RefreshToken"
    ADD COLUMN "deviceInfo" TEXT,
    ADD COLUMN "deviceType" TEXT,
    ADD COLUMN "location" TEXT,
    ADD COLUMN "fcmToken" TEXT,
    ADD COLUMN "ipAddress" TEXT,
    ADD COLUMN "userAgent" TEXT,
    ADD COLUMN "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "RefreshToken_userId_revokedAt_expiresAt_idx"
    ON "RefreshToken"("userId", "revokedAt", "expiresAt");

-- The current Figma KYC flow reads personal/bank data and requires three photos.
ALTER TABLE "KycSubmission"
    ALTER COLUMN "dateOfBirth" DROP NOT NULL,
    ALTER COLUMN "idCardNumber" DROP NOT NULL,
    ADD COLUMN "bankAccountName" TEXT,
    ADD COLUMN "bankAccountNumber" TEXT,
    ADD COLUMN "bankName" TEXT,
    ADD COLUMN "selfieFileUrl" TEXT;
