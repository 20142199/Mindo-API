import { Controller, Get, Param, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthenticatedRequest, JwtAuthGuard, authUser } from '../auth/auth.guard';
import { ok } from '../common/api-response';
import { DepositHistoryQueryDto, NftHistoryQueryDto } from './history.dto';
import { HistoryService } from './history.service';

@ApiTags('Investor history')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/investor/history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get('nfts')
  async nfts(@Req() req: AuthenticatedRequest, @Query() query: NftHistoryQueryDto) {
    const result = await this.history.nftHistory(authUser(req).id, query);
    return ok(result.data, 'Thành công', result.extra);
  }

  @Get('nfts/:id')
  nftDetail(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.history.nftDetail(authUser(req).id, id).then((data) => ok(data));
  }

  @Get('deposits')
  async deposits(@Req() req: AuthenticatedRequest, @Query() query: DepositHistoryQueryDto) {
    const result = await this.history.depositHistory(authUser(req).id, query);
    return ok(result.data, 'Thành công', result.extra);
  }

  @Get('deposits/:id')
  depositDetail(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.history.depositDetail(authUser(req).id, id).then((data) => ok(data));
  }

  @Get('deposits/:id/receipt')
  async receipt(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const receipt = await this.history.depositReceipt(authUser(req).id, id);
    response.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${receipt.filename}"`,
      'Content-Length': receipt.content.byteLength.toString(),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(receipt.content);
  }
}
