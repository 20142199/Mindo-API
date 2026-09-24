import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { AiMessage, AiMessageKind, AiMessageRole, AiMessageStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { pageExtra } from '../common/api-response';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { AiContextMessage, AiProviderService } from './ai-provider.service';
import { AiConversationQueryDto, AiMessageQueryDto, CreateAiConversationDto, CreateAiMessageDto, UpsertAiExpertDto } from './phase2.dto';

const AI_LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' },
  { code: 'fr', label: 'Français' },
] as const;

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: AiProviderService,
    private readonly files: FileStorageService,
    @InjectQueue('ai-response') private readonly queue: Queue,
  ) {}

  async experts(activeOnly = true, search?: string) {
    const q = search?.trim();
    const where: Prisma.AiExpertWhereInput = {
      ...(activeOnly ? { isActive: true } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { specialty: { contains: q, mode: 'insensitive' } }] } : {}),
    };
    const rows = await this.prisma.aiExpert.findMany({ where, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    if (!activeOnly) return rows;
    return rows.map(({ systemPrompt: _systemPrompt, ...expert }) => ({
      ...expert,
      initials: expert.name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]?.toLocaleUpperCase('vi')).join(''),
      availability: 'ONLINE',
      availability_label: 'Đang hoạt động',
    }));
  }

  config() {
    return {
      modes: [
        { code: AiMessageKind.CHAT, label: 'Trò chuyện', credits: 1 },
        { code: AiMessageKind.IMAGE, label: 'Tạo ảnh', credits: 1 },
        { code: AiMessageKind.DOCUMENT, label: 'Tạo tài liệu', credits: 1 },
        { code: AiMessageKind.TRANSLATION, label: 'Dịch thuật', credits: 1, max_characters: 1_000 },
      ],
      providers: {
        primary: process.env.LLM_PRIMARY_VENDOR ?? 'gemini',
        fallback: process.env.LLM_FALLBACK_VENDOR ?? 'deepseek',
        image: 'gemini',
      },
      languages: AI_LANGUAGES,
      upload: { max_size_bytes: 10 * 1024 * 1024, mime_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
    };
  }

  async createConversation(userId: string, dto: CreateAiConversationDto) {
    const expert = await this.prisma.aiExpert.findUnique({ where: { id: dto.expert_id } });
    if (!expert?.isActive) throw new NotFoundException('Chuyên gia AI không tồn tại');
    return this.prisma.aiConversation.create({
      data: { userId, expertId: expert.id, title: dto.title?.trim() || `Trò chuyện với ${expert.name}` },
      include: { expert: true, messages: true },
    });
  }

  /**
   * Trần yêu cầu AI mỗi ngày.
   *
   * Đọc một chỗ duy nhất vì HAI nơi cần: `sendMessage` để chặn, và `usage` để
   * app biết trước còn bao nhiêu lượt. Trước đây con số này nằm inline trong
   * `sendMessage`, nên thêm endpoint `usage` mà quên sửa là hai nơi lệch nhau.
   */
  private dailyLimit() {
    return Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 50);
  }

  /** Mốc 0h hôm nay — cửa sổ tính quota trùng với ngày theo giờ máy chủ */
  private static startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Số yêu cầu đã dùng hôm nay, đếm theo tin của NGƯỜI DÙNG trên mọi hội thoại */
  private countUsedToday(userId: string) {
    return this.prisma.aiMessage.count({
      where: { conversation: { userId }, role: AiMessageRole.USER, createdAt: { gte: AiService.startOfToday() } },
    });
  }

  /**
   * Quota còn lại. App gọi lúc mở màn chat để chặn TRƯỚC khi người dùng gõ,
   * thay vì để họ soạn xong rồi mới báo hết lượt.
   */
  async usage(userId: string) {
    const limit = this.dailyLimit();
    const used = await this.countUsedToday(userId);
    return { used, limit, remaining: Math.max(0, limit - used) };
  }

  /**
   * Danh sách hội thoại, MỚI NHẤT TRƯỚC, có phân trang.
   *
   * `messages` cố tình chỉ lấy MỘT tin gần nhất — app chỉ cần nó để suy ra
   * loại phiên (icon ở dòng danh sách). Kéo cả cây tin nhắn ở đây là thừa.
   *
   * Sắp xếp thêm `id` sau `updatedAt`: hai hội thoại có cùng mốc `updatedAt`
   * (hay gặp khi tạo hàng loạt lúc test) mà không có khoá phụ thì thứ tự giữa
   * các trang không ổn định — một dòng có thể xuất hiện ở cả trang 1 lẫn
   * trang 2, hoặc biến mất hẳn.
   */
  async listConversations(userId: string, query: AiConversationQueryDto) {
    const where = { userId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiConversation.count({ where }),
      this.prisma.aiConversation.findMany({
        where,
        include: { expert: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { data: rows, extra: pageExtra(query.page, query.limit, total) };
  }

  async getConversation(userId: string, id: string) {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id, userId },
      include: { expert: true, messages: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!conversation) throw new NotFoundException('Cuộc trò chuyện không tồn tại');
    const messages = await this.messageViews(conversation.messages.reverse());
    return { ...conversation, messages };
  }

  async listMessages(userId: string, conversationId: string, query: AiMessageQueryDto) {
    const exists = await this.prisma.aiConversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Cuộc trò chuyện không tồn tại');
    const where = { conversationId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.aiMessage.count({ where }),
      this.prisma.aiMessage.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return {
      data: await this.messageViews(rows.reverse()),
      extra: pageExtra(query.page, query.limit, total),
    };
  }

  private async messageViews(messages: AiMessage[]) {
    const attachmentIds = [...new Set(messages.flatMap((message) => {
      const metadata = (message.metadata ?? {}) as Record<string, unknown>;
      return typeof metadata.attachmentFileId === 'string' ? [metadata.attachmentFileId] : [];
    }))];
    const files = attachmentIds.length
      ? await this.prisma.fileUpload.findMany({ where: { id: { in: attachmentIds } } })
      : [];
    const byId = new Map(files.map((file) => [file.id, this.files.view(file)]));
    return messages.map((message) => {
      const metadata = (message.metadata ?? {}) as Record<string, unknown>;
      const attachment = typeof metadata.attachmentFileId === 'string' ? byId.get(metadata.attachmentFileId) : undefined;
      return { ...message, attachment: attachment ?? null };
    });
  }

  async sendMessage(userId: string, conversationId: string, dto: CreateAiMessageDto) {
    const conversation = await this.getConversation(userId, conversationId);
    const kind = dto.kind ?? AiMessageKind.CHAT;
    const capabilities = Array.isArray(conversation.expert.capabilities) ? conversation.expert.capabilities.map(String) : [];
    if (!capabilities.includes(kind)) throw new BadRequestException('Chuyên gia này không hỗ trợ loại yêu cầu đã chọn');
    const attachment = dto.attachment_file_id ? await this.files.assertOwned(userId, dto.attachment_file_id) : undefined;
    if (attachment && kind === AiMessageKind.IMAGE) throw new BadRequestException('Chế độ tạo ảnh chưa hỗ trợ file đính kèm');
    const sourceLanguage = dto.source_language ? this.language(dto.source_language) : undefined;
    const targetLanguage = dto.target_language ? this.language(dto.target_language) : undefined;
    if (kind === AiMessageKind.TRANSLATION && !targetLanguage) throw new BadRequestException('Cần chọn ngôn ngữ đích hợp lệ');
    if (kind === AiMessageKind.TRANSLATION && dto.content.length > 1_000) throw new BadRequestException('Nội dung dịch không được vượt quá 1.000 ký tự');
    const pending = await this.prisma.aiMessage.findFirst({
      where: { conversationId, role: AiMessageRole.ASSISTANT, status: AiMessageStatus.PENDING },
      select: { id: true },
    });
    if (pending) throw new ConflictException({ message: 'AI đang xử lý yêu cầu trước đó', code: 'AI_MESSAGE_PENDING', message_id: pending.id });
    const limit = this.dailyLimit();
    const dailyUsed = await this.countUsedToday(userId);
    /*
      Gắn `code` chứ không chỉ có câu chữ: app phải phân biệt lỗi này với mọi
      lỗi 400 khác để mở đúng màn "hết lượt" thay vì thẻ lỗi đỏ. Trước đây app
      phải dò chữ "giới hạn" trong thông báo tiếng Việt — sửa chính tả một cái
      là hỏng.
    */
    if (dailyUsed >= limit) {
      throw new BadRequestException({
        message: `Đã đạt giới hạn ${limit} yêu cầu AI trong ngày`,
        code: 'AI_DAILY_LIMIT_REACHED',
        used: dailyUsed,
        limit,
      });
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const userMessage = await tx.aiMessage.create({
        data: {
          conversationId,
          role: AiMessageRole.USER,
          kind,
          status: AiMessageStatus.COMPLETED,
          content: dto.content.trim(),
          completedAt: new Date(),
          metadata: dto.attachment_file_id ? { attachmentFileId: dto.attachment_file_id } : undefined,
        },
      });
      const assistantMessage = await tx.aiMessage.create({
        data: {
          conversationId,
          role: AiMessageRole.ASSISTANT,
          kind,
          status: AiMessageStatus.PENDING,
          content: '',
          metadata: {
            requestedAt: new Date().toISOString(),
            ...(sourceLanguage ? { sourceLanguage: sourceLanguage.code } : {}),
            ...(targetLanguage ? { targetLanguage: targetLanguage.code } : {}),
          },
        },
      });
      const title = conversation.messages.length === 0 ? dto.content.trim().slice(0, 70) : undefined;
      await tx.aiConversation.update({ where: { id: conversationId }, data: { ...(title ? { title } : {}), updatedAt: new Date() } });
      return { user_message: userMessage, assistant_message: assistantMessage };
    });
    try {
      await this.enqueue(result.assistant_message.id, result.assistant_message.id);
    } catch {
      await this.prisma.aiMessage.update({
        where: { id: result.assistant_message.id },
        data: { status: AiMessageStatus.FAILED, errorMessage: 'Không thể xếp lịch xử lý AI', completedAt: new Date() },
      });
      throw new ServiceUnavailableException('Không thể xếp lịch xử lý AI');
    }
    return result;
  }

  private language(value: string) {
    const clean = value.trim().toLocaleLowerCase('vi');
    const language = AI_LANGUAGES.find((item) => item.code === clean || item.label.toLocaleLowerCase('vi') === clean);
    if (!language) throw new BadRequestException(`Ngôn ngữ không được hỗ trợ: ${value}`);
    return language;
  }

  private enqueue(messageId: string, jobId: string) {
    return this.queue.add('generate', { messageId }, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 500,
      removeOnFail: 500,
    });
  }

  /**
   * Đổi tên hội thoại.
   *
   * `getConversation` chạy trước để chặn việc đổi tên hội thoại của người
   * khác: nó lọc theo `userId` và ném 404 nếu không khớp. Không có bước đó thì
   * `update({where: {id}})` sẽ đổi được bất kỳ hội thoại nào chỉ cần biết id.
   */
  async renameConversation(userId: string, id: string, title: string) {
    await this.getConversation(userId, id);
    const clean = title.trim();
    if (!clean) throw new BadRequestException('Tên cuộc trò chuyện không được để trống');
    return this.prisma.aiConversation.update({
      where: { id },
      data: { title: clean },
      include: { expert: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  /**
   * Xoá hội thoại. Tin nhắn đi theo nhờ `onDelete: Cascade` khai trong
   * `schema.prisma`, không phải xoá tay.
   *
   * Job đang chạy dở trong BullMQ vẫn sẽ chạy tiếp rồi hỏng lúc ghi kết quả
   * (không còn hội thoại) — chấp nhận được, `ai.processor` đã có `attempts: 3`
   * và job hỏng không ảnh hưởng gì tới người dùng.
   */
  async removeConversation(userId: string, id: string) {
    await this.getConversation(userId, id);
    await this.prisma.aiConversation.delete({ where: { id } });
    return { id, deleted: true };
  }

  async processMessage(messageId: string, finalAttempt = true) {
    const message = await this.prisma.aiMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { expert: true } } },
    });
    if (!message || message.status === AiMessageStatus.COMPLETED) return message;
    const input = await this.prisma.aiMessage.findFirst({
      where: { conversationId: message.conversationId, role: AiMessageRole.USER, createdAt: { lte: message.createdAt } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!input) throw new NotFoundException('Không tìm thấy yêu cầu AI');
    const metadata = (message.metadata ?? {}) as Record<string, unknown>;
    try {
      const contextRows = await this.prisma.aiMessage.findMany({
        where: {
          conversationId: message.conversationId,
          status: AiMessageStatus.COMPLETED,
          role: { in: [AiMessageRole.USER, AiMessageRole.ASSISTANT] },
          createdAt: { lte: input.createdAt },
        },
        select: { id: true, role: true, content: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Number(process.env.AI_CONTEXT_MESSAGES ?? 20) + 1,
      });
      const history: AiContextMessage[] = contextRows
        .filter((row) => row.id !== input.id)
        .slice(0, Number(process.env.AI_CONTEXT_MESSAGES ?? 20))
        .reverse()
        .map((row) => ({
          role: row.role === AiMessageRole.ASSISTANT ? 'assistant' : 'user',
          content: row.content,
        }));
      const inputMetadata = (input.metadata ?? {}) as Record<string, unknown>;
      const attachmentId = typeof inputMetadata.attachmentFileId === 'string' ? inputMetadata.attachmentFileId : undefined;
      const storedAttachment = attachmentId ? await this.files.readOwned(message.conversation.userId, attachmentId) : undefined;
      const generated = await this.provider.generate(message.conversation.expert, message.kind, input.content, {
        sourceLanguage: typeof metadata.sourceLanguage === 'string' ? this.language(metadata.sourceLanguage).label : undefined,
        targetLanguage: typeof metadata.targetLanguage === 'string' ? this.language(metadata.targetLanguage).label : undefined,
        history,
        attachment: storedAttachment ? {
          name: storedAttachment.file.originalName,
          mimeType: storedAttachment.file.mimeType,
          content: storedAttachment.content,
        } : undefined,
      });
      return await this.prisma.aiMessage.update({
        where: { id: message.id },
        data: {
          status: AiMessageStatus.COMPLETED,
          content: generated.content,
          attachmentUrl: generated.attachmentUrl,
          metadata: { ...metadata, ...(generated.metadata ?? {}) } as Prisma.InputJsonValue,
          completedAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Nhà cung cấp AI chưa thể trả lời';
      await this.prisma.aiMessage.update({
        where: { id: message.id },
        data: {
          status: finalAttempt ? AiMessageStatus.FAILED : AiMessageStatus.PENDING,
          errorMessage: reason,
          completedAt: finalAttempt ? new Date() : null,
        },
      });
      throw error;
    }
  }

  async retryMessage(userId: string, messageId: string) {
    const message = await this.prisma.aiMessage.findFirst({
      where: { id: messageId, role: AiMessageRole.ASSISTANT, conversation: { userId } },
    });
    if (!message) throw new NotFoundException('Tin nhắn AI không tồn tại');
    if (message.status !== AiMessageStatus.FAILED) throw new ConflictException('Chỉ có thể thử lại tin nhắn đã thất bại');
    const metadata = (message.metadata ?? {}) as Record<string, unknown>;
    const updated = await this.prisma.aiMessage.updateMany({
      where: { id: messageId, status: AiMessageStatus.FAILED },
      data: {
        status: AiMessageStatus.PENDING,
        content: '',
        attachmentUrl: null,
        errorMessage: null,
        completedAt: null,
        metadata: { ...metadata, retryCount: Number(metadata.retryCount ?? 0) + 1, retriedAt: new Date().toISOString() } as Prisma.InputJsonValue,
      },
    });
    if (!updated.count) throw new ConflictException('Tin nhắn đang được xử lý');
    try {
      await this.enqueue(messageId, `retry-${messageId}-${Date.now()}`);
    } catch {
      await this.prisma.aiMessage.update({
        where: { id: messageId },
        data: { status: AiMessageStatus.FAILED, errorMessage: 'Không thể xếp lịch thử lại', completedAt: new Date() },
      });
      throw new ServiceUnavailableException('Không thể xếp lịch thử lại');
    }
    return this.prisma.aiMessage.findUniqueOrThrow({ where: { id: messageId } });
  }

  async document(userId: string, messageId: string) {
    const message = await this.prisma.aiMessage.findFirst({
      where: { id: messageId, kind: AiMessageKind.DOCUMENT, status: AiMessageStatus.COMPLETED, conversation: { userId } },
    });
    if (!message) throw new NotFoundException('Tài liệu AI không tồn tại');
    const metadata = (message.metadata ?? {}) as Record<string, unknown>;
    return { filename: String(metadata.filename ?? 'tai-lieu-mindo.md'), mimeType: String(metadata.mime_type ?? 'text/markdown'), content: message.content };
  }

  async upsertExpert(id: string | undefined, dto: UpsertAiExpertDto) {
    const data = {
      name: dto.name,
      slug: dto.slug,
      specialty: dto.specialty,
      description: dto.description,
      systemPrompt: dto.system_prompt,
      avatarUrl: dto.avatar_url,
      capabilities: dto.capabilities ?? ['CHAT'],
      isActive: dto.is_active ?? true,
    };
    return id
      ? this.prisma.aiExpert.update({ where: { id }, data })
      : this.prisma.aiExpert.create({ data });
  }

  async toggleExpert(id: string) {
    const expert = await this.prisma.aiExpert.findUniqueOrThrow({ where: { id } });
    return this.prisma.aiExpert.update({ where: { id }, data: { isActive: !expert.isActive } });
  }
}
