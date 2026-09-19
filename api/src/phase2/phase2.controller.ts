import { Body, Controller, Delete, Get, Headers, MessageEvent, Param, Patch, Post, Query, Req, Res, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AgencyStatus, UserRole } from '@prisma/client';
import type { Response } from 'express';
import { from, interval, map, startWith, switchMap } from 'rxjs';
import { AuthenticatedRequest, JwtAuthGuard, Roles, authUser } from '../auth/auth.guard';
import { ok } from '../common/api-response';
import { AgencyService } from './agency.service';
import { AiService } from './ai.service';
import {
  BuyAgencyPackageDto,
  CreateAdminAccountDto,
  CreateAgencyApplicationDto,
  CreateAiConversationDto,
  CreateAiMessageDto,
  ResetAdminPasswordDto,
  ReviewAgencyDto,
  UpdateAdminRoleDto,
  UpdateAgencyStoreDto,
  UpsertAiExpertDto,
} from './phase2.dto';

const adminRoles = [UserRole.ADMIN, UserRole.COMPLIANCE, UserRole.FINANCE];

@ApiTags('Phase 2')
@Controller('api/v1')
export class Phase2Controller {
  constructor(private readonly agencies: AgencyService, private readonly ai: AiService) {}

  @Get('agency-stores/:slug')
  store(@Param('slug') slug: string) { return this.agencies.publicStore(slug).then((data) => ok(data)); }

  @Get('ai/experts')
  experts() { return this.ai.experts().then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/agency/applications')
  apply(@Req() req: AuthenticatedRequest, @Body() dto: CreateAgencyApplicationDto) {
    return this.agencies.apply(authUser(req).id, dto).then((data) => ok(data, 'Đã gửi hồ sơ đăng ký đại lý'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/agency/me')
  myAgency(@Req() req: AuthenticatedRequest) { return this.agencies.mine(authUser(req).id).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Patch('investor/agency/store')
  updateStore(@Req() req: AuthenticatedRequest, @Body() dto: UpdateAgencyStoreDto) {
    return this.agencies.updateStore(authUser(req).id, dto).then((data) => ok(data, 'Đã cập nhật cửa hàng'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/agency/packages')
  buyPackage(@Req() req: AuthenticatedRequest, @Body() dto: BuyAgencyPackageDto) {
    return this.agencies.buyPackage(authUser(req).id, dto).then((data) => ok(data, 'Đã mua gói đại lý'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/agency/dashboard')
  agencyDashboard(@Req() req: AuthenticatedRequest) { return this.agencies.dashboard(authUser(req).id).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/ai/conversations')
  createConversation(@Req() req: AuthenticatedRequest, @Body() dto: CreateAiConversationDto) {
    return this.ai.createConversation(authUser(req).id, dto).then((data) => ok(data, 'Đã tạo cuộc trò chuyện'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/ai/conversations')
  conversations(@Req() req: AuthenticatedRequest) { return this.ai.listConversations(authUser(req).id).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/ai/conversations/:id')
  conversation(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.ai.getConversation(authUser(req).id, id).then((data) => ok(data));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/ai/conversations/:id/messages')
  message(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: CreateAiMessageDto) {
    return this.ai.sendMessage(authUser(req).id, id, dto).then((data) => ok(data, 'Đang xử lý yêu cầu AI'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Sse('investor/ai/conversations/:id/events')
  conversationEvents(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const userId = authUser(req).id;
    return interval(1_000).pipe(
      startWith(0),
      switchMap(() => from(this.ai.getConversation(userId, id))),
      map((data): MessageEvent => ({ data })),
    );
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/ai/messages/:id/document')
  async document(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Res() response: Response) {
    const file = await this.ai.document(authUser(req).id, id);
    response.set({ 'Content-Type': file.mimeType, 'Content-Disposition': `attachment; filename="${file.filename.replace(/[^a-zA-Z0-9._-]/g, '-') }"` });
    response.send(file.content);
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(...adminRoles) @Get('admin/agencies/stats')
  agencyStats() { return this.agencies.adminStats().then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(...adminRoles) @Get('admin/agencies/tree')
  agencyTree() { return this.agencies.tree().then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(...adminRoles) @Get('admin/agencies')
  agencyList(@Query('search') search?: string, @Query('status') status?: AgencyStatus) {
    return this.agencies.adminList(search, status).then((data) => ok(data));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(...adminRoles) @Get('admin/agencies/:id')
  agencyDetail(@Param('id') id: string) { return this.agencies.detail(id).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN, UserRole.COMPLIANCE) @Post('admin/agencies/:id/review')
  reviewAgency(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: ReviewAgencyDto) {
    return this.agencies.review(authUser(req).id, id, dto).then((data) => ok(data, 'Đã cập nhật đại lý'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(...adminRoles) @Get('admin/agencies/:id/contract')
  async contract(@Param('id') id: string, @Res() response: Response) {
    const contract = await this.agencies.contractHtml(id);
    response.set({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${contract.filename}"` });
    response.send(contract.html);
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Get('admin/accounts')
  adminAccounts() { return this.agencies.adminAccounts().then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Post('admin/accounts')
  createAdmin(@Req() req: AuthenticatedRequest, @Body() dto: CreateAdminAccountDto) {
    return this.agencies.createAdmin(authUser(req).id, dto).then((data) => ok(data, 'Đã tạo tài khoản quản trị'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Patch('admin/accounts/:id/role')
  updateAdminRole(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdateAdminRoleDto) {
    return this.agencies.updateAdminRole(authUser(req).id, id, dto).then((data) => ok(data, 'Đã cập nhật phân quyền'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Post('admin/accounts/:id/reset-password')
  resetAdmin(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: ResetAdminPasswordDto) {
    return this.agencies.resetAdminPassword(authUser(req).id, id, dto).then((data) => ok(data, 'Đã đặt lại mật khẩu'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Delete('admin/accounts/:id')
  deleteAdmin(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.agencies.deleteAdmin(authUser(req).id, id).then((data) => ok(data, 'Đã xóa tài khoản quản trị'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Get('admin/ai-experts')
  adminExperts() { return this.ai.experts(false).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Post('admin/ai-experts')
  createExpert(@Body() dto: UpsertAiExpertDto) { return this.ai.upsertExpert(undefined, dto).then((data) => ok(data, 'Đã tạo chuyên gia AI')); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Patch('admin/ai-experts/:id')
  updateExpert(@Param('id') id: string, @Body() dto: UpsertAiExpertDto) { return this.ai.upsertExpert(id, dto).then((data) => ok(data, 'Đã cập nhật chuyên gia AI')); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Post('admin/ai-experts/:id/toggle')
  toggleExpert(@Param('id') id: string) { return this.ai.toggleExpert(id).then((data) => ok(data, 'Đã cập nhật trạng thái chuyên gia AI')); }
}
