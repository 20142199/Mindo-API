import { Body, Controller, Delete, Get, Headers, MessageEvent, Param, Patch, Post, Query, Req, Res, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AgencyStatus, AiMessageStatus, UserRole } from '@prisma/client';
import type { Response } from 'express';
import { distinctUntilChanged, from, interval, map, startWith, switchMap, takeWhile } from 'rxjs';
import { AuthenticatedRequest, JwtAuthGuard, Roles, authUser } from '../auth/auth.guard';
import { ok } from '../common/api-response';
import { AgencyService } from './agency.service';
import { AiService } from './ai.service';
import {
  AiConversationQueryDto,
  BuyAgencyPackageDto,
  CreateAdminAccountDto,
  CreateAgencyApplicationDto,
  CreateAiConversationDto,
  CreateAiMessageDto,
  RenameAiConversationDto,
  ResetAdminPasswordDto,
  ReviewAgencyDto,
  UpdateAdminRoleDto,
  UpdateAgencyPackageSettingDto,
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

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/agency/packages/config')
  agencyPackageConfig() { return this.agencies.packageConfig().then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/agency/dashboard')
  agencyDashboard(@Req() req: AuthenticatedRequest) { return this.agencies.dashboard(authUser(req).id).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/ai/conversations')
  createConversation(@Req() req: AuthenticatedRequest, @Body() dto: CreateAiConversationDto) {
    return this.ai.createConversation(authUser(req).id, dto).then((data) => ok(data, 'Đã tạo cuộc trò chuyện'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/ai/conversations')
  conversations(@Req() req: AuthenticatedRequest, @Query() query: AiConversationQueryDto) {
    return this.ai
      .listConversations(authUser(req).id, query)
      .then(({ data, extra }) => ok(data, 'Thành công', extra));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/ai/conversations/:id')
  conversation(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.ai.getConversation(authUser(req).id, id).then((data) => ok(data));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Patch('investor/ai/conversations/:id')
  renameConversation(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: RenameAiConversationDto) {
    return this.ai.renameConversation(authUser(req).id, id, dto.title).then((data) => ok(data, 'Đã đổi tên cuộc trò chuyện'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Delete('investor/ai/conversations/:id')
  deleteConversation(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.ai.removeConversation(authUser(req).id, id).then((data) => ok(data, 'Đã xóa cuộc trò chuyện'));
  }

  /* Đặt TRƯỚC `conversations/:id` thì không cần, vì đây là đường khác hẳn —
     nhưng để cạnh nhóm AI cho dễ đọc. */
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/ai/usage')
  aiUsage(@Req() req: AuthenticatedRequest) {
    return this.ai.usage(authUser(req).id).then((data) => ok(data));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/ai/conversations/:id/messages')
  message(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: CreateAiMessageDto) {
    return this.ai.sendMessage(authUser(req).id, id, dto).then((data) => ok(data, 'Đang xử lý yêu cầu AI'));
  }

  /**
   * Theo dõi một hội thoại tới khi AI trả lời xong.
   *
   * Vẫn là polling 1 giây, nhưng có hai cái van:
   *
   * `distinctUntilChanged` — không đẩy khung giống hệt khung trước. Đo ngày
   *   23/09/2026: hội thoại 2 tin đã xong đẩy 10 khung trong 10 giây, cả 10
   *   giống hệt nhau, mỗi khung 1.739 byte. Toàn bộ là lặp lại.
   *
   * `takeWhile(..., true)` — dừng khi không còn tin nào PENDING. Tham số thứ
   *   hai là `inclusive`: khung CUỐI (khung báo đã xong) vẫn được gửi rồi mới
   *   đóng. Thiếu nó thì client chờ mãi khung không bao giờ tới.
   *
   * Trước hai van này, một người mở màn chat rồi bỏ đó là 86.400 truy vấn
   * database mỗi ngày để nói cùng một điều.
   *
   * CHƯA PHẢI ĐÍCH CUỐI: vẫn gửi TOÀN BỘ hội thoại mỗi lần đổi, không gửi
   * riêng phần thay đổi. Hội thoại càng dài khung càng phình. Muốn dứt điểm
   * thì `ai.processor` phải bắn sự kiện qua Redis pub/sub và bỏ hẳn polling.
   */
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Sse('investor/ai/conversations/:id/events')
  conversationEvents(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const userId = authUser(req).id;
    return interval(1_000).pipe(
      startWith(0),
      switchMap(() => from(this.ai.getConversation(userId, id))),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      takeWhile((data) => data.messages.some((m) => m.status === AiMessageStatus.PENDING), true),
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

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(...adminRoles) @Get('admin/agency-package-settings')
  agencyPackageSettings() { return this.agencies.packageConfig().then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Patch('admin/agency-package-settings')
  updateAgencyPackageSettings(@Req() req: AuthenticatedRequest, @Body() dto: UpdateAgencyPackageSettingDto) {
    return this.agencies.updatePackageConfig(authUser(req).id, dto).then((data) => ok(data, 'Đã cập nhật tỷ giá gói đại lý'));
  }

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
