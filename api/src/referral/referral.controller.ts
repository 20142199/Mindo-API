import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard, Roles, authUser } from '../auth/auth.guard';
import { ok } from '../common/api-response';
import { CreateSystemReferralCodeDto, ReferralCommissionQueryDto, ReferralPeriodQueryDto, UpdateReferralSettingsDto, UpdateSystemReferralCodeDto } from './referral.dto';
import { ReferralService } from './referral.service';

@ApiTags('Referral')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1')
export class ReferralController {
  constructor(private readonly service: ReferralService) {}

  @Get('investor/referrals/dashboard')
  dashboard(@Req() request: AuthenticatedRequest) {
    return this.service.dashboard(authUser(request).id).then((data) => ok(data));
  }

  @Get('investor/referrals/commissions')
  async commissions(@Req() request: AuthenticatedRequest, @Query() query: ReferralCommissionQueryDto) {
    const result = await this.service.commissions(authUser(request).id, query);
    return ok(result.data, 'Thành công', result.extra);
  }

  @Get('investor/referrals/commissions/:id')
  commission(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.commissionDetail(authUser(request).id, id).then((data) => ok(data));
  }

  @Get('investor/referrals/branch-sales')
  async branchSales(@Req() request: AuthenticatedRequest, @Query() query: ReferralPeriodQueryDto) {
    const result = await this.service.branchSales(authUser(request).id, query);
    return ok(result.data, 'Thành công', result.extra);
  }

  @Roles(UserRole.ADMIN, UserRole.FINANCE) @Get('admin/referrals/settings')
  settings() { return this.service.getSettings().then((data) => ok(data)); }

  @Roles(UserRole.ADMIN) @Patch('admin/referrals/settings')
  updateSettings(@Req() request: AuthenticatedRequest, @Body() dto: UpdateReferralSettingsDto) {
    return this.service.updateSettings(authUser(request).id, dto).then((data) => ok(data, 'Đã cập nhật tỷ lệ thưởng'));
  }

  @Roles(UserRole.ADMIN, UserRole.FINANCE) @Get('admin/referrals/system-codes')
  systemCodes() { return this.service.listSystemCodes().then((data) => ok(data)); }

  @Roles(UserRole.ADMIN) @Post('admin/referrals/system-codes')
  createSystemCode(@Req() request: AuthenticatedRequest, @Body() dto: CreateSystemReferralCodeDto) {
    return this.service.createSystemCode(authUser(request).id, dto).then((data) => ok(data, 'Đã tạo mã đầu nhánh'));
  }

  @Roles(UserRole.ADMIN) @Patch('admin/referrals/system-codes/:id')
  updateSystemCode(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdateSystemReferralCodeDto) {
    return this.service.setSystemCodeActive(authUser(request).id, id, dto.is_active).then((data) => ok(data, 'Đã cập nhật mã đầu nhánh'));
  }
}
