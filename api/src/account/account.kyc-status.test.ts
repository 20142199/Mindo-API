import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AccountService } from './account.service';

/**
 * `kyc.status` của `GET /investor/account` (2026-10-03).
 *
 * Trang Cá nhân hiện "Chưa KYC" cho một người đã được duyệt. `kyc.status` chỉ
 * đọc hồ sơ KYC mới nhất, trong khi nguồn sự thật là `User.kycVerifiedAt` —
 * cổng mua NFT, Peer và đại lý đều xét cột đó, `/investor/me` cũng vậy. Người
 * được duyệt mà không có hồ sơ (seed, set tay) thì ra 'none'; người đã duyệt
 * nộp lại hồ sơ thì ra 'pending' / 'rejected'. Giờ có `kycVerifiedAt` là
 * 'approved', không thì mới rơi về hồ sơ mới nhất.
 */

const verifiedAt = new Date('2026-09-01T00:00:00Z');
const submittedAt = new Date('2026-09-20T00:00:00Z');
const reviewedAt = new Date('2026-09-21T00:00:00Z');

function submission(status: 'PENDING' | 'APPROVED' | 'REJECTED', extra: Record<string, unknown> = {}) {
  return { status, rejectionReason: null, createdAt: submittedAt, reviewedAt: null, ...extra };
}

async function accountWith(kycVerifiedAt: Date | null, submissions: unknown[], approvedSubmission: unknown = null) {
  const findFirst = vi.fn().mockResolvedValue(approvedSubmission);
  const prisma = {
    kycSubmission: { findFirst },
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'u-me',
        email: 'me@mindo.test',
        fullName: 'Tôi',
        phone: null,
        address: null,
        avatarFileId: null,
        balanceVnd: new Prisma.Decimal('0'),
        agencyTitle: null,
        totalPackagesPurchased: 0,
        referralCode: 'ABC',
        bankAccountName: null,
        bankAccountNumber: null,
        bankName: null,
        kycVerifiedAt,
        kycSubmissions: submissions,
        agency: null,
        createdAt: submittedAt,
        updatedAt: submittedAt,
      }),
    },
  };
  const account = await new AccountService(prisma as never, {} as never).getAccount('u-me');
  return Object.assign(account, { findFirst });
}

describe('kyc.status ưu tiên kycVerifiedAt', () => {
  it('đã duyệt mà không có hồ sơ nào (seed / set tay): approved', async () => {
    const account = await accountWith(verifiedAt, []);
    expect(account.kyc).toEqual({
      status: 'approved',
      rejection_reason: null,
      submitted_at: null,
      reviewed_at: verifiedAt.getTime(),
    });
    expect(account.onboarding.kyc_completed).toBe(true);
  });

  it('hồ sơ mới nhất là hồ sơ được duyệt: lấy luôn, không truy vấn thêm', async () => {
    const approvedAt = new Date('2026-08-30T00:00:00Z');
    const account = await accountWith(verifiedAt, [submission('APPROVED', { createdAt: approvedAt, reviewedAt: verifiedAt })]);
    expect(account.kyc).toEqual({
      status: 'approved',
      rejection_reason: null,
      submitted_at: approvedAt.getTime(),
      reviewed_at: verifiedAt.getTime(),
    });
    expect(account.findFirst).not.toHaveBeenCalled();
  });

  /* Hồ sơ nộp lại (20/09) muộn hơn lúc duyệt (01/09). Lấy nó làm `submitted_at`
     thì app hiện "duyệt" trước "nộp" — phải là hồ sơ ĐƯỢC DUYỆT (30/08). */
  it('đã duyệt rồi nộp lại, hồ sơ mới đang chờ: vẫn approved, mốc nộp là của hồ sơ được duyệt', async () => {
    const approvedAt = new Date('2026-08-30T00:00:00Z');
    const account = await accountWith(verifiedAt, [submission('PENDING')], submission('APPROVED', { createdAt: approvedAt }));
    expect(account.kyc.status).toBe('approved');
    expect(account.kyc.submitted_at).toBe(approvedAt.getTime());
    expect(account.kyc.submitted_at!).toBeLessThanOrEqual(account.kyc.reviewed_at!);
    expect(account.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u-me', status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('đã duyệt rồi hồ sơ nộp lại bị từ chối: vẫn approved, không kèm lý do', async () => {
    const account = await accountWith(verifiedAt, [
      submission('REJECTED', { rejectionReason: 'Ảnh mờ', reviewedAt }),
    ]);
    expect(account.kyc.status).toBe('approved');
    expect(account.kyc.rejection_reason).toBeNull();
    /* Không còn hồ sơ được duyệt nào (set tay): không có mốc nộp. */
    expect(account.kyc.submitted_at).toBeNull();
    expect(account.onboarding.kyc_completed).toBe(true);
  });
});

describe('chưa duyệt: rơi về hồ sơ mới nhất', () => {
  it('chưa có hồ sơ: none', async () => {
    const account = await accountWith(null, []);
    expect(account.kyc).toEqual({ status: 'none', rejection_reason: null, submitted_at: null, reviewed_at: null });
    expect(account.onboarding.kyc_completed).toBe(false);
    expect(account.findFirst).not.toHaveBeenCalled();
  });

  it('hồ sơ đang chờ: pending', async () => {
    const account = await accountWith(null, [submission('PENDING')]);
    expect(account.kyc.status).toBe('pending');
  });

  it('hồ sơ bị từ chối: rejected kèm lý do và lúc duyệt', async () => {
    const account = await accountWith(null, [
      submission('REJECTED', { rejectionReason: 'Ảnh mờ', reviewedAt }),
    ]);
    expect(account.kyc).toEqual({
      status: 'rejected',
      rejection_reason: 'Ảnh mờ',
      submitted_at: submittedAt.getTime(),
      reviewed_at: reviewedAt.getTime(),
    });
  });
});
