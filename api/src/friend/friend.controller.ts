import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  AuthenticatedRequest,
  JwtAuthGuard,
  authUser,
} from "../auth/auth.guard";
import { ok } from "../common/api-response";
import {
  FriendListQueryDto,
  FriendRequestQueryDto,
  SendFriendRequestDto,
  UpdateFriendAliasDto,
  UpdateFriendAvatarDto,
} from "./friend.dto";
import { FriendService } from "./friend.service";

@ApiTags("Investor friends")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("api/v1/investor/friends")
export class FriendController {
  constructor(private readonly friends: FriendService) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query() query: FriendListQueryDto,
  ) {
    const result = await this.friends.list(authUser(req).id, query);
    return ok(result.data, "Thành công", result.extra);
  }

  @Post("requests")
  sendRequest(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SendFriendRequestDto,
  ) {
    return this.friends
      .sendRequest(authUser(req).id, dto.identifier)
      .then((data) => ok(data, "Đã gửi lời mời kết bạn"));
  }

  @Get("requests")
  async requests(
    @Req() req: AuthenticatedRequest,
    @Query() query: FriendRequestQueryDto,
  ) {
    const result = await this.friends.requests(authUser(req).id, query);
    return ok(result.data, "Thành công", result.extra);
  }

  @Post("requests/:userId/accept")
  accept(@Req() req: AuthenticatedRequest, @Param("userId") userId: string) {
    return this.friends
      .accept(authUser(req).id, userId)
      .then((data) => ok(data, "Đã chấp nhận lời mời kết bạn"));
  }

  @Post("requests/:userId/reject")
  reject(@Req() req: AuthenticatedRequest, @Param("userId") userId: string) {
    return this.friends
      .reject(authUser(req).id, userId)
      .then((data) => ok(data, "Đã từ chối lời mời kết bạn"));
  }

  @Delete("requests/:userId")
  cancel(@Req() req: AuthenticatedRequest, @Param("userId") userId: string) {
    return this.friends
      .cancel(authUser(req).id, userId)
      .then((data) => ok(data, "Đã hủy lời mời kết bạn"));
  }

  @Patch(":userId")
  setAlias(
    @Req() req: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Body() dto: UpdateFriendAliasDto,
  ) {
    return this.friends
      .setAlias(authUser(req).id, userId, dto.alias, {
        phone: dto.alias_phone,
        email: dto.alias_email,
      })
      .then((data) =>
        ok(data, dto.alias ? "Đã đổi tên gợi nhớ" : "Đã xoá tên gợi nhớ"),
      );
  }

  /* Đường riêng chứ không gộp vào `PATCH :userId`: ảnh và tên gợi nhớ đi từ
     hai thao tác khác nhau trên màn hình, và gộp lại thì một lần đổi tên sẽ
     phải gửi kèm id ảnh hiện tại — quên là mất ảnh. */
  @Patch(":userId/avatar")
  setAvatar(
    @Req() req: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Body() dto: UpdateFriendAvatarDto,
  ) {
    return this.friends
      .setAvatar(authUser(req).id, userId, dto.avatar_file_id ?? null)
      .then((data) =>
        ok(data, dto.avatar_file_id ? "Đã đổi ảnh liên hệ" : "Đã xoá ảnh liên hệ"),
      );
  }

  @Delete(":userId")
  remove(@Req() req: AuthenticatedRequest, @Param("userId") userId: string) {
    return this.friends
      .remove(authUser(req).id, userId)
      .then((data) => ok(data, "Đã xóa bạn"));
  }
}
