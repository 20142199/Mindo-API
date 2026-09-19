import { Body, Controller, Get, Headers, Param, Post, Query, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DepositStatus, ReviewStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthenticatedRequest, JwtAuthGuard, Roles, authUser } from '../auth/auth.guard';
import { ok } from '../common/api-response';
import { FileStorageService } from './file-storage.service';
import { CalculatePriceDto, CreateArticleDto, CreateDepositDto, CreateKycDto, CreateNftProductDto, DepositReviewDto, InvestDto, ReviewDto, SnapshotPriceDto, VietQrCallbackDto } from './phase1.dto';
import { Phase1Service } from './phase1.service';
import { VietQrService } from './vietqr.service';

type AuthedRequest = AuthenticatedRequest;
const adminRoles = [UserRole.ADMIN, UserRole.COMPLIANCE, UserRole.FINANCE];

@ApiTags('Phase 1')
@Controller('api/v1')
export class Phase1Controller {
  constructor(
    private readonly service: Phase1Service,
    private readonly files: FileStorageService,
    private readonly vietQr: VietQrService,
  ) {}

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } })) @Post('investor/files/upload')
  uploadKycFile(@Req() req: AuthedRequest, @UploadedFile() file?: Express.Multer.File) {
    return this.files.save(authUser(req).id, file).then((data) => ok(data, 'Đã tải file lên'));
  }

  @Get('files/:id/content')
  async fileContent(
    @Param('id') id: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.files.resolveSignedContent(id, expires, signature);
    response.set({
      'Content-Type': result.file.mimeType,
      'Content-Length': result.file.size.toString(),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(result.content);
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/kyc/submissions')
  createKyc(@Req() req: AuthedRequest, @Body() dto: CreateKycDto) {
    return this.service.createKyc(authUser(req).id, dto).then((data) => ok(data, 'Đã gửi hồ sơ KYC'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/kyc/submissions/current')
  myKyc(@Req() req: AuthedRequest) { return this.service.getMyKyc(authUser(req).id).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/kyc/submissions/me')
  myKycLegacy(@Req() req: AuthedRequest) { return this.service.getMyKyc(authUser(req).id).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/deposits')
  createDeposit(@Req() req: AuthedRequest, @Headers('idempotency-key') key: string | undefined, @Body() dto: CreateDepositDto) {
    return this.service.createDeposit(authUser(req).id, dto, key || randomUUID()).then((data) => ok(data, 'Đã tạo lệnh nạp'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/deposits')
  myDeposits(@Req() req: AuthedRequest) { return this.service.listDeposits(authUser(req).id).then((data) => ok(data)); }

  @Post('webhooks/vietqr/transaction-sync')
  async syncVietQr(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-webhook-secret') secret: string | undefined,
    @Body() dto: VietQrCallbackDto,
  ) {
    await this.vietQr.assertCallbackAuthorization(authorization, secret);
    const deposit = await this.service.syncVietQrPayment(dto);
    return { error: false, errorReason: '', toastMessage: '', object: { reftransactionid: deposit.bankTransactionId ?? '' } };
  }

  @Get('nfts') products() { return this.service.listProducts().then((data) => ok(data)); }
  @Get('news') news() { return this.service.articles().then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/invest/calculate-price')
  calculate(@Body() dto: CalculatePriceDto) { return this.service.calculatePrice(dto.project_id, dto.amount).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/invest/snapshot-price')
  snapshot(@Req() req: AuthedRequest, @Body() dto: SnapshotPriceDto) {
    return this.service.createSnapshot(authUser(req).id, dto.nft_id, dto.amount, dto.payment_type).then((data) => ok(data));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('investor/invest')
  invest(@Req() req: AuthedRequest, @Body() dto: InvestDto) {
    return this.service.purchase(authUser(req).id, dto.price_snapshot, dto.agency_code).then((data) => ok(data, 'Đã mua và cấp NFT nội bộ'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/me/nfts')
  myNfts(@Req() req: AuthedRequest, @Query('project_id') productId?: string) {
    return this.service.myNfts(authUser(req).id, productId).then((data) => ok(data));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('investor/transactions/nfts')
  myTransactions(@Req() req: AuthedRequest) { return this.service.transactions(authUser(req).id).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(...adminRoles) @Get('admin/dashboard')
  dashboard() { return this.service.dashboard().then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(...adminRoles) @Get('admin/users')
  users() { return this.service.users().then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN, UserRole.COMPLIANCE) @Get('admin/kyc')
  kyc(@Query('status') status?: ReviewStatus) { return this.service.listKyc(status).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN, UserRole.COMPLIANCE) @Post('admin/kyc/:id/review')
  reviewKyc(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.service.reviewKyc(authUser(req).id, id, dto).then((data) => ok(data, 'Đã cập nhật hồ sơ KYC'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN, UserRole.FINANCE) @Get('admin/deposits')
  deposits(@Query('status') status?: DepositStatus) { return this.service.listDeposits(undefined, status).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN, UserRole.FINANCE) @Post('admin/deposits/:id/confirm')
  confirmDeposit(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: DepositReviewDto) {
    return this.service.confirmDeposit(authUser(req).id, id, dto.review_note).then((data) => ok(data, 'Đã xác nhận tiền vào'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN, UserRole.FINANCE) @Post('admin/deposits/:id/reject')
  rejectDeposit(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: DepositReviewDto) {
    return this.service.rejectDeposit(authUser(req).id, id, dto.review_note).then((data) => ok(data, 'Đã từ chối lệnh nạp'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Get('admin/nfts')
  adminNfts() { return this.service.listProducts(false).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Post('admin/nfts')
  createNft(@Body() dto: CreateNftProductDto) { return this.service.createProduct(dto).then((data) => ok(data, 'Đã tạo NFT')); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(...adminRoles) @Get('admin/transactions')
  transactions() { return this.service.transactions().then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Get('admin/news')
  adminNews() { return this.service.articles(false).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Roles(UserRole.ADMIN) @Post('admin/news')
  createNews(@Body() dto: CreateArticleDto) { return this.service.createArticle(dto).then((data) => ok(data, 'Đã tạo tin tức')); }
}
