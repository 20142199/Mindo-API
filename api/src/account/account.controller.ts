import { Body, Controller, Delete, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { authUser, AuthenticatedRequest, JwtAuthGuard } from '../auth/auth.guard';
import { ok } from '../common/api-response';
import { UpdateAccountSettingsDto, UpdateProfileDto } from './account.dto';
import { AccountService } from './account.service';

@ApiTags('Investor account')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/investor/account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  getAccount(@Req() req: AuthenticatedRequest) {
    return this.account.getAccount(authUser(req).id).then((data) => ok(data));
  }

  @Patch('profile')
  updateProfile(@Req() req: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    return this.account.updateProfile(authUser(req).id, dto).then((data) => ok(data, 'Đã cập nhật thông tin'));
  }

  @Get('settings')
  settings(@Req() req: AuthenticatedRequest) {
    return this.account.getSettings(authUser(req).id).then((data) => ok(data));
  }

  @Patch('settings')
  updateSettings(@Req() req: AuthenticatedRequest, @Body() dto: UpdateAccountSettingsDto) {
    return this.account.updateSettings(authUser(req).id, dto).then((data) => ok(data, 'Đã cập nhật cài đặt'));
  }

  @Get('sessions')
  sessions(@Req() req: AuthenticatedRequest) {
    const user = authUser(req);
    return this.account.sessions(user.id, user.sid).then((data) => ok(data));
  }

  @Delete('sessions/:id')
  revokeSession(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.account.revokeSession(authUser(req).id, id).then((data) => ok(data, 'Đã đăng xuất phiên'));
  }

  @Delete('sessions')
  revokeAllSessions(@Req() req: AuthenticatedRequest) {
    return this.account.revokeAllSessions(authUser(req).id).then((data) => ok(data, 'Đã đăng xuất tất cả thiết bị'));
  }
}
