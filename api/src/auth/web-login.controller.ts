import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ok } from '../common/api-response';
import { CreateWebLoginDto, PollWebLoginDto } from './auth.dto';
import { authUser, AuthenticatedRequest, JwtAuthGuard } from './auth.guard';
import { WebLoginService } from './web-login.service';

/**
 * Đăng nhập web bằng mã QR — xem docs/web-qr-login-design.md.
 *
 * Hai nhóm người gọi: WEB (chưa đăng nhập, qua BFF) tạo mã và hỏi trạng thái;
 * APP (đã đăng nhập) quét, duyệt hoặc từ chối.
 */
@ApiTags('Authentication')
@Controller('api/v1/investor/auth/qr')
export class WebLoginController {
  constructor(private readonly webLogin: WebLoginService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateWebLoginDto) {
    return this.webLogin
      .create({ ...this.context(req), deviceInfo: dto.device_info })
      .then((data) => ok(data));
  }

  /* POST chứ không GET: khoá nằm trong body, không lọt lên URL hay log truy cập */
  @Post(':id/poll')
  poll(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: PollWebLoginDto) {
    return this.webLogin.poll(id, dto.secret, this.context(req)).then((data) => ok(data));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post(':id/scan')
  scan(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.webLogin.scan(authUser(req).id, id).then((data) => ok(data));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post(':id/approve')
  approve(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.webLogin
      .decide(authUser(req).id, id, true)
      .then((data) => ok(data, 'Đã đăng nhập trên máy tính'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post(':id/reject')
  reject(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.webLogin
      .decide(authUser(req).id, id, false)
      .then((data) => ok(data, 'Đã từ chối đăng nhập'));
  }

  private context(req: Request) {
    return { ipAddress: req.ip || req.socket.remoteAddress, userAgent: req.headers['user-agent'] };
  }
}
