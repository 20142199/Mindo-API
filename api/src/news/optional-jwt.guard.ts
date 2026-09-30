import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser, AuthenticatedRequest } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.module';

@Injectable()
export class OptionalJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return true;
    try {
      const user = await this.jwt.verifyAsync<AuthUser>(header.slice(7), { secret: process.env.JWT_ACCESS_SECRET });
      if (!user.sid || !(await this.prisma.refreshToken.findFirst({
        where: { id: user.sid, userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      }))) return true;
      request.user = user;
    } catch {
      request.user = undefined;
    }
    return true;
  }
}
