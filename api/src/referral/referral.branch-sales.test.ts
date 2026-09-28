import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReferralService } from './referral.service';

describe('branch sales authorization', () => {
  it('only allows an account that claimed a system referral code', async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ claimedSystemReferralCode: null }),
      },
    };
    const service = new ReferralService(prisma as never);

    await expect(service.branchSales('regular-user', { page: 1, limit: 20 })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
