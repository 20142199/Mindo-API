import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { JwtAuthGuard } from './auth.guard';

function context(request: { headers: { authorization?: string }; user?: unknown }) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function setup(session: { id: string } | null) {
  const jwt = { verifyAsync: vi.fn().mockResolvedValue({ id: 'admin-1', role: UserRole.ADMIN, sid: 'session-1' }) };
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue([UserRole.ADMIN]) };
  const prisma = { refreshToken: { findFirst: vi.fn().mockResolvedValue(session) } };
  return {
    jwt,
    prisma,
    guard: new JwtAuthGuard(jwt as unknown as JwtService, reflector as unknown as Reflector, prisma as unknown as PrismaService),
  };
}

describe('JwtAuthGuard — phiên đăng nhập phía máy chủ', () => {
  it('cho phép token thuộc phiên còn hiệu lực', async () => {
    const { guard, prisma } = setup({ id: 'session-1' });
    const request = { headers: { authorization: 'Bearer access-token' } };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'session-1', userId: 'admin-1', revokedAt: null }),
    }));
  });

  it('từ chối access token ngay sau khi phiên đã bị thu hồi', async () => {
    const { guard } = setup(null);
    const request = { headers: { authorization: 'Bearer access-token' } };

    await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
