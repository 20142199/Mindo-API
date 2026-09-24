import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser, AuthenticatedRequest } from '../auth/auth.guard';

@Injectable()
export class OptionalJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return true;
    try {
      request.user = await this.jwt.verifyAsync<AuthUser>(header.slice(7), { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      request.user = undefined;
    }
    return true;
  }
}
