-- Đăng nhập web bằng mã QR — xem docs/web-qr-login-design.md.
--
-- Mỗi hàng là một mã QR đang chờ. Chỉ `id` in trong QR; khoá để web đổi lấy
-- token chỉ lưu dạng băm. Mã sống 60 giây nên bảng nhỏ; dịch vụ tự dọn các hàng
-- quá một ngày mỗi lần tạo mã mới, không cần tiến trình riêng.

-- CreateEnum
CREATE TYPE "WebLoginStatus" AS ENUM ('PENDING', 'SCANNED', 'APPROVED', 'REJECTED', 'CONSUMED');

-- CreateTable
CREATE TABLE "WebLoginRequest" (
    "id" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "status" "WebLoginStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "browser" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scannedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "WebLoginRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebLoginRequest_expiresAt_idx" ON "WebLoginRequest"("expiresAt");

-- AddForeignKey
ALTER TABLE "WebLoginRequest" ADD CONSTRAINT "WebLoginRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

