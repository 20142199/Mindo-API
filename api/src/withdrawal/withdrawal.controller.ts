import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard, Roles, authUser } from '../auth/auth.guard';
import { ok } from '../common/api-response';
import { FileStorageService } from '../phase1/file-storage.service';
import { ApproveWithdrawalDto, CreateWithdrawalDto, RejectWithdrawalDto, WithdrawalQueryDto } from './withdrawal.dto';
import { WithdrawalService } from './withdrawal.service';

const PROOF_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

@ApiTags('Withdrawals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1')
export class WithdrawalController {
  constructor(
    private readonly withdrawals: WithdrawalService,
    private readonly files: FileStorageService,
  ) {}

  @Post('investor/withdrawals')
  create(@Req() req: AuthenticatedRequest, @Headers('idempotency-key') key: string | undefined, @Body() dto: CreateWithdrawalDto) {
    if (!key?.trim()) throw new BadRequestException('Thiếu Idempotency-Key');
    return this.withdrawals.create(authUser(req).id, key, dto).then((data) => ok(data, 'Đã tạo lệnh rút và giữ số dư'));
  }

  @Get('investor/withdrawals')
  mine(@Req() req: AuthenticatedRequest) {
    return this.withdrawals.mine(authUser(req).id).then((data) => ok(data));
  }

  @Get('investor/withdrawals/:id')
  myDetail(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.withdrawals.myDetail(authUser(req).id, id).then((data) => ok(data));
  }

  @Roles(UserRole.ADMIN, UserRole.FINANCE) @Get('admin/withdrawals')
  adminList(@Query() query: WithdrawalQueryDto) {
    return this.withdrawals.adminList(query.status).then((data) => ok(data));
  }

  @Roles(UserRole.ADMIN, UserRole.FINANCE) @Get('admin/withdrawals/:id')
  adminDetail(@Param('id') id: string) {
    return this.withdrawals.adminDetail(id).then((data) => ok(data));
  }

  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @Post('admin/withdrawals/proof/upload')
  uploadProof(@Req() req: AuthenticatedRequest, @UploadedFile() file?: Express.Multer.File) {
    return this.files.save(authUser(req).id, file, PROOF_IMAGE_TYPES).then((data) => ok(data, 'Đã tải ảnh chuyển khoản'));
  }

  @Roles(UserRole.ADMIN, UserRole.FINANCE) @Post('admin/withdrawals/:id/approve')
  approve(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: ApproveWithdrawalDto) {
    return this.withdrawals.approve(authUser(req).id, id, dto).then((data) => ok(data, 'Đã duyệt lệnh rút'));
  }

  @Roles(UserRole.ADMIN, UserRole.FINANCE) @Post('admin/withdrawals/:id/reject')
  reject(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: RejectWithdrawalDto) {
    return this.withdrawals.reject(authUser(req).id, id, dto).then((data) => ok(data, 'Đã từ chối và hoàn tiền'));
  }
}
