import {
  Body,
  Controller,
  Delete,
  BadRequestException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest, JwtAuthGuard, authUser } from '../auth/auth.guard';
import { ok } from '../common/api-response';
import { CHAT_ALLOWED_MIME_TYPES, FileStorageService } from '../phase1/file-storage.service';
import {
  AddGroupMembersDto,
  ChatMessageQueryDto,
  ChatPageQueryDto,
  CreateChatMessageDto,
  CreateGroupConversationDto,
  EditChatMessageDto,
  MarkConversationReadDto,
  StartDirectConversationDto,
  UpdateGroupConversationDto,
  UpdateMuteDto,
} from './chat.dto';
import { ChatRealtimeService } from './chat-realtime.service';
import { ChatService } from './chat.service';

@ApiTags('Investor messaging')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/investor/chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly realtime: ChatRealtimeService,
    private readonly files: FileStorageService,
  ) {}

  @Get('conversations')
  async conversations(@Req() req: AuthenticatedRequest, @Query() query: ChatPageQueryDto) {
    const result = await this.chat.listConversations(authUser(req).id, query);
    return ok(result.data, 'Thành công', result.extra);
  }

  @Post('conversations/direct')
  async startDirect(@Req() req: AuthenticatedRequest, @Body() dto: StartDirectConversationDto) {
    const data = await this.chat.startDirect(authUser(req).id, dto.user_id);
    await this.realtime.publishConversation(data.conversation_id);
    return ok(data, 'Đã mở cuộc trò chuyện');
  }

  @Post('conversations/groups')
  async createGroup(@Req() req: AuthenticatedRequest, @Body() dto: CreateGroupConversationDto) {
    const data = await this.chat.createGroup(authUser(req).id, dto);
    await this.realtime.publishConversation(data.conversation_id);
    this.realtime.publishSystemMessage(data.conversation_id, data.system_message);
    return ok(data, 'Đã tạo nhóm');
  }

  @Get('conversations/:conversationId')
  getConversation(@Req() req: AuthenticatedRequest, @Param('conversationId') conversationId: string) {
    return this.chat.getConversation(authUser(req).id, conversationId).then((data) => ok(data));
  }

  @Get('conversations/:conversationId/messages')
  getMessages(
    @Req() req: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Query() query: ChatMessageQueryDto,
  ) {
    return this.chat.listMessages(authUser(req).id, conversationId, query).then((data) => ok(data));
  }

  @Post('conversations/:conversationId/messages')
  async sendMessage(
    @Req() req: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateChatMessageDto,
  ) {
    const result = await this.chat.sendMessage(authUser(req).id, conversationId, dto);
    if (!result.duplicate) await this.realtime.publishNewMessage(conversationId, result.message);
    return ok(result, result.duplicate ? 'Tin nhắn đã được ghi nhận trước đó' : 'Đã gửi tin nhắn');
  }

  @Post('conversations/:conversationId/read')
  async markRead(
    @Req() req: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Body() dto: MarkConversationReadDto,
  ) {
    const userId = authUser(req).id;
    const data = await this.chat.markRead(userId, conversationId, dto.message_id);
    this.realtime.publishRead(conversationId, userId, data);
    return ok(data, 'Đã đánh dấu đã đọc');
  }

  @Patch('conversations/:conversationId/mute')
  setMuted(
    @Req() req: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateMuteDto,
  ) {
    return this.chat.setMuted(authUser(req).id, conversationId, dto.is_muted).then((data) => ok(data));
  }

  @Delete('conversations/:conversationId')
  async hideConversation(@Req() req: AuthenticatedRequest, @Param('conversationId') conversationId: string) {
    const userId = authUser(req).id;
    const data = await this.chat.hideConversation(userId, conversationId);
    this.realtime.publishConversationRemoved(userId, conversationId, 'hidden');
    return ok(data, 'Đã xóa hội thoại khỏi danh sách');
  }

  @Patch('groups/:conversationId')
  async updateGroup(
    @Req() req: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateGroupConversationDto,
  ) {
    const data = await this.chat.updateGroup(authUser(req).id, conversationId, dto);
    await this.realtime.publishConversation(conversationId);
    return ok(data, 'Đã cập nhật nhóm');
  }

  @Post('groups/:conversationId/members')
  async addMembers(
    @Req() req: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Body() dto: AddGroupMembersDto,
  ) {
    const data = await this.chat.addMembers(authUser(req).id, conversationId, dto);
    await this.realtime.publishConversation(conversationId);
    this.realtime.publishSystemMessage(conversationId, data.system_message);
    return ok(data, 'Đã thêm thành viên');
  }

  @Delete('groups/:conversationId/members/:userId')
  async removeMember(
    @Req() req: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Param('userId') userId: string,
  ) {
    const data = await this.chat.removeMember(authUser(req).id, conversationId, userId);
    this.realtime.publishConversationRemoved(userId, conversationId, 'removed');
    await this.realtime.publishConversation(conversationId);
    /* Người tự rời nhóm đi qua `leaveGroup`, đường đó không sinh tin hệ
       thống nên không phải lúc nào cũng có. */
    if ('system_message' in data) {
      this.realtime.publishSystemMessage(conversationId, data.system_message);
    }
    return ok(data, 'Đã cập nhật thành viên');
  }

  @Delete('groups/:conversationId/leave')
  async leaveGroup(@Req() req: AuthenticatedRequest, @Param('conversationId') conversationId: string) {
    const userId = authUser(req).id;
    const data = await this.chat.leaveGroup(userId, conversationId);
    this.realtime.publishConversationRemoved(userId, conversationId, 'left');
    await this.realtime.publishConversation(conversationId);
    return ok(data, 'Đã rời nhóm');
  }

  @Delete('groups/:conversationId')
  async deleteGroup(@Req() req: AuthenticatedRequest, @Param('conversationId') conversationId: string) {
    const data = await this.chat.deleteGroup(authUser(req).id, conversationId);
    await this.realtime.publishGroupDeleted(conversationId, data);
    return ok(data, 'Đã xóa nhóm');
  }

  @Patch('messages/:messageId')
  async editMessage(@Req() req: AuthenticatedRequest, @Param('messageId') messageId: string, @Body() dto: EditChatMessageDto) {
    const data = await this.chat.editMessage(authUser(req).id, messageId, dto);
    this.realtime.publishMessageUpdated(data.conversation_id, data);
    return ok(data, 'Đã sửa tin nhắn');
  }

  @Delete('messages/:messageId')
  async deleteMessage(@Req() req: AuthenticatedRequest, @Param('messageId') messageId: string) {
    const data = await this.chat.deleteMessage(authUser(req).id, messageId);
    this.realtime.publishMessageDeleted(data.conversation_id, data);
    return ok(data, 'Đã thu hồi tin nhắn');
  }

  @Post('messages/:messageId/save')
  saveMessage(@Req() req: AuthenticatedRequest, @Param('messageId') messageId: string) {
    return this.chat.saveMessage(authUser(req).id, messageId, true).then((data) => ok(data, 'Đã lưu tin nhắn'));
  }

  @Delete('messages/:messageId/save')
  unsaveMessage(@Req() req: AuthenticatedRequest, @Param('messageId') messageId: string) {
    return this.chat.saveMessage(authUser(req).id, messageId, false).then((data) => ok(data, 'Đã bỏ lưu tin nhắn'));
  }

  @Get('saved-messages')
  async savedMessages(@Req() req: AuthenticatedRequest, @Query() query: ChatPageQueryDto) {
    const result = await this.chat.listSavedMessages(authUser(req).id, query);
    return ok(result.data, 'Thành công', result.extra);
  }

  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 5, { limits: { fileSize: 10 * 1024 * 1024, files: 5 } }))
  @Post('attachments')
  async uploadAttachments(@Req() req: AuthenticatedRequest, @UploadedFiles() uploads?: Express.Multer.File[]) {
    if (!uploads?.length) throw new BadRequestException('Vui lòng chọn ít nhất một tệp');
    const data = await Promise.all(uploads.map((file) => this.files.save(authUser(req).id, file, CHAT_ALLOWED_MIME_TYPES)));
    return ok(data, 'Đã tải tệp lên');
  }
}
