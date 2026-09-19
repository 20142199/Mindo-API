import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { ok } from '../common/api-response';
import { PrismaService } from '../common/prisma.module';
import { ChangePasswordDto, EmailDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto, VerifyOtpDto } from './auth.dto';
import { authUser, AuthenticatedRequest, JwtAuthGuard } from './auth.guard';
import { AuthService, userView } from './auth.service';

@ApiTags('Authentication')
@Controller('api/v1')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService) {}

  @Post('investor/auth/login/email') login(@Req() req: Request, @Body() dto: LoginDto) {
    return this.auth.login(dto, undefined, this.sessionContext(req, dto)).then((data) => ok(data));
  }
  @Post('admin/auth/login') adminLogin(@Req() req: Request, @Body() dto: LoginDto) {
    return this.auth.login(dto, [UserRole.ADMIN, UserRole.COMPLIANCE, UserRole.FINANCE], this.sessionContext(req, dto)).then((data) => ok(data));
  }
  @Post('investor/auth/register') register(@Body() dto: RegisterDto) { return this.auth.register(dto).then((data) => ok(data)); }
  @Post('investor/auth/register/otp') registerOtp(@Body() dto: EmailDto) { return this.auth.requestOtp(dto.email, 'register').then((data) => ok(data)); }
  @Post('investor/auth/verify-account') verify(@Body() dto: VerifyOtpDto) { return this.auth.verifyOtp(dto, 'register').then((data) => ok(data)); }
  @Post('investor/auth/forgot-password') forgot(@Body() dto: EmailDto) { return this.auth.requestPasswordReset(dto.email).then((data) => ok(data)); }
  @Post('investor/auth/forgot-password/verify-otp') verifyResetOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyPasswordResetOtp(dto).then((data) => ok(data));
  }
  @Post('investor/auth/reset-password') reset(@Body() dto: ResetPasswordDto) { return this.auth.resetPassword(dto).then((data) => ok(data)); }
  @Post('investor/auth/refresh-token') refresh(@Req() req: Request, @Body() dto: RefreshDto) {
    return this.auth.refresh(dto, this.sessionContext(req)).then((data) => ok(data));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/auth/logout')
  logout(@Req() req: AuthenticatedRequest) {
    const user = authUser(req);
    return this.auth.logout(user.id, user.sid).then((data) => ok(data));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/auth/logout-all')
  logoutAll(@Req() req: AuthenticatedRequest) { return this.auth.logout(authUser(req).id).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/auth/update-password')
  changePassword(@Req() req: AuthenticatedRequest, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(authUser(req).id, dto).then((data) => ok(data));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/me')
  async me(@Req() req: AuthenticatedRequest) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: authUser(req).id } });
    return ok(userView(user));
  }

  private sessionContext(req: Request, dto?: LoginDto) {
    return {
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      deviceInfo: dto?.device_info,
      deviceType: dto?.device_type,
      location: dto?.device_location,
      fcmToken: dto?.fcm_token,
    };
  }
}
