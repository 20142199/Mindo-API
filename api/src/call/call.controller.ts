import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest, JwtAuthGuard, authUser } from '../auth/auth.guard';
import { ok } from '../common/api-response';
import { CallClientDto, CallHistoryQueryDto, CallTokenQueryDto, EndCallDto, InitiateCallDto } from './call.dto';
import { CallService } from './call.service';

@ApiTags('Audio and video calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/investor/calls')
export class CallController {
  constructor(private readonly calls: CallService) {}

  @Post('initiate')
  initiate(@Req() req: AuthenticatedRequest, @Body() dto: InitiateCallDto) {
    return this.calls.initiate(authUser(req).id, dto).then((data) => ok(data, 'Đã bắt đầu cuộc gọi'));
  }

  @Get('history')
  async history(@Req() req: AuthenticatedRequest, @Query() query: CallHistoryQueryDto) {
    const result = await this.calls.history(authUser(req).id, query);
    return ok(result.data, 'Thành công', result.extra);
  }

  @Get('rtm-token')
  async rtmToken(@Req() req: AuthenticatedRequest, @Query() query: CallTokenQueryDto) {
    return ok(await this.calls.rtmToken(authUser(req).id, query.client));
  }

  @Get('incoming')
  incoming(@Req() req: AuthenticatedRequest) {
    return this.calls.incoming(authUser(req).id).then((data) => ok(data));
  }

  @Get('active')
  active(@Req() req: AuthenticatedRequest) {
    return this.calls.active(authUser(req).id).then((data) => ok(data));
  }

  @Get(':callId')
  get(@Req() req: AuthenticatedRequest, @Param('callId') callId: string) {
    return this.calls.get(authUser(req).id, callId).then((data) => ok(data));
  }

  @Post(':callId/token')
  token(
    @Req() req: AuthenticatedRequest,
    @Param('callId') callId: string,
    @Body() dto: CallClientDto,
  ) {
    return this.calls.refreshMediaToken(authUser(req).id, callId, dto.client_platform).then((data) => ok(data));
  }

  @Post(':callId/accept')
  accept(
    @Req() req: AuthenticatedRequest,
    @Param('callId') callId: string,
    @Body() dto: CallClientDto,
  ) {
    return this.calls.accept(authUser(req).id, callId, dto.client_platform).then((data) => ok(data, 'Đã nhận cuộc gọi'));
  }

  @Post(':callId/reject')
  reject(@Req() req: AuthenticatedRequest, @Param('callId') callId: string) {
    return this.calls.reject(authUser(req).id, callId).then((data) => ok(data, 'Đã từ chối cuộc gọi'));
  }

  @Post(':callId/end')
  end(
    @Req() req: AuthenticatedRequest,
    @Param('callId') callId: string,
    @Body() dto: EndCallDto,
  ) {
    return this.calls.end(authUser(req).id, callId, dto.reason).then((data) => ok(data, 'Đã kết thúc cuộc gọi'));
  }
}
