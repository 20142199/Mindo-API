import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest, JwtAuthGuard, authUser } from '../auth/auth.guard';
import { ok } from '../common/api-response';
import { FriendListQueryDto, FriendRequestQueryDto, SendFriendRequestDto } from './friend.dto';
import { FriendService } from './friend.service';

@ApiTags('Investor friends')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/investor/friends')
export class FriendController {
  constructor(private readonly friends: FriendService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query() query: FriendListQueryDto) {
    const result = await this.friends.list(authUser(req).id, query);
    return ok(result.data, 'Thành công', result.extra);
  }

  @Post('requests')
  sendRequest(@Req() req: AuthenticatedRequest, @Body() dto: SendFriendRequestDto) {
    return this.friends.sendRequest(authUser(req).id, dto.identifier).then((data) => ok(data, 'Đã gửi lời mời kết bạn'));
  }

  @Get('requests')
  async requests(@Req() req: AuthenticatedRequest, @Query() query: FriendRequestQueryDto) {
    const result = await this.friends.requests(authUser(req).id, query);
    return ok(result.data, 'Thành công', result.extra);
  }

  @Post('requests/:userId/accept')
  accept(@Req() req: AuthenticatedRequest, @Param('userId') userId: string) {
    return this.friends.accept(authUser(req).id, userId).then((data) => ok(data, 'Đã chấp nhận lời mời kết bạn'));
  }

  @Post('requests/:userId/reject')
  reject(@Req() req: AuthenticatedRequest, @Param('userId') userId: string) {
    return this.friends.reject(authUser(req).id, userId).then((data) => ok(data, 'Đã từ chối lời mời kết bạn'));
  }

  @Delete('requests/:userId')
  cancel(@Req() req: AuthenticatedRequest, @Param('userId') userId: string) {
    return this.friends.cancel(authUser(req).id, userId).then((data) => ok(data, 'Đã hủy lời mời kết bạn'));
  }

  @Delete(':userId')
  remove(@Req() req: AuthenticatedRequest, @Param('userId') userId: string) {
    return this.friends.remove(authUser(req).id, userId).then((data) => ok(data, 'Đã xóa bạn'));
  }
}
