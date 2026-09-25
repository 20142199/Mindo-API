import { randomBytes } from 'node:crypto';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function referralCode(prefix: 'MD' | 'SYS', entropy = randomBytes(8)) {
  let suffix = '';
  for (let index = 0; index < 8; index += 1) suffix += alphabet[entropy[index] % alphabet.length];
  return `${prefix}${suffix}`;
}

/**
 * Mọi mã giới thiệu hợp lệ chỉ gồm chữ và số.
 *
 *   - mã người dùng   `MD` + 8 ký tự từ `alphabet` ở trên
 *   - mã đầu nhánh    `SYS` + 8 ký tự, cùng bảng chữ
 *   - mã đại lý       `DL` + base36 viết hoa
 *   - dữ liệu cũ      cuid 25 ký tự, `[a-z0-9]`
 *
 * Hàm này KHÔNG phải kiểm tra hình thức cho đẹp. Nhánh tra mã người dùng trong
 * `auth.service.ts` dùng `equals` kèm `mode: 'insensitive'`, mà Prisma dịch tổ
 * hợp đó thành `ILIKE` — nơi `%` và `_` là KÝ TỰ ĐẠI DIỆN. Không chặn ở đây thì
 * `ref_by: "%"` khớp với người dùng đầu tiên trong bảng, và người đăng ký được
 * gắn vào nhánh hoa hồng của một người hoàn toàn xa lạ.
 *
 * Đã tái tạo được trên API thật ngày 25/09/2026: đăng ký với `ref_by: "%"` trả
 * về 200 kèm `referred_by_id` của một tài khoản có thật.
 *
 * Nói cách khác: bỏ hàm này đi là mở lại lỗ hổng, không phải nới lỏng validation.
 */
export function isReferralCodeShape(code: string) {
  return /^[A-Za-z0-9]{1,64}$/.test(code);
}

export function percentToRate(percent: number) {
  return percent / 100;
}

export function rateToPercent(rate: { toNumber(): number } | number) {
  return (typeof rate === 'number' ? rate : rate.toNumber()) * 100;
}

