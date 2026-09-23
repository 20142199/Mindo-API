import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { AiMessageKind, AiMessageRole, AiMessageStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { pageExtra } from '../common/api-response';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { AiProviderService } from './ai-provider.service';
import { AiConversationQueryDto, CreateAiConversationDto, CreateAiMessageDto, UpsertAiExpertDto } from './phase2.dto';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: AiProviderService,
    private readonly files: FileStorageService,
    @InjectQueue('ai-response') private readonly queue: Queue,
  ) {}

  experts(activeOnly = true) {
    return this.prisma.aiExpert.findMany({ where: activeOnly ? { isActive: true } : {}, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
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
      include: { expert: true, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) throw new NotFoundException('Cuộc trò chuyện không tồn tại');
    return conversation;
  }

  async sendMessage(userId: string, conversationId: string, dto: CreateAiMessageDto) {
    const conversation = await this.getConversation(userId, conversationId);
    if (dto.attachment_file_id) await this.files.assertOwned(userId, dto.attachment_file_id);
    const kind = dto.kind ?? AiMessageKind.CHAT;
    const capabilities = Array.isArray(conversation.expert.capabilities) ? conversation.expert.capabilities.map(String) : [];
    if (!capabilities.includes(kind)) throw new BadRequestException('Chuyên gia này không hỗ trợ loại yêu cầu đã chọn');
    if (kind === AiMessageKind.TRANSLATION && !dto.target_language?.trim()) throw new BadRequestException('Cần chọn ngôn ngữ đích');
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
          metadata: dto.target_language ? { targetLanguage: dto.target_language } : undefined,
        },
      });
      const title = conversation.messages.length === 0 ? dto.content.trim().slice(0, 70) : undefined;
      await tx.aiConversation.update({ where: { id: conversationId }, data: { ...(title ? { title } : {}), updatedAt: new Date() } });
      return { user_message: userMessage, assistant_message: assistantMessage };
    });
    /*
      Xếp hàng đợi nằm NGOÀI transaction, nên tới đây hai tin đã nằm trong
      CSDL rồi. Trước đây lỗi ở dòng này bay thẳng ra ngoài thành 500 và bỏ
      lại một tin `PENDING` không ai xử lý: app mở lại hội thoại là thấy ba
      chấm quay mãi, còn `SSE /events` thì hỏi CSDL mỗi giây cho tới khi
      người dùng bỏ đi — vì nó chỉ đóng khi không còn tin `PENDING` nào.

      Nên hỏng ở đây phải tự dọn: đánh dấu `FAILED` để hội thoại có kết cục,
      rồi mới báo lỗi. Người dùng thấy một câu trả lời hỏng có thể gửi lại,
      thay vì một ô chờ không bao giờ xong.
    */
    try {
      await this.queue.add('generate', { messageId: result.assistant_message.id }, { jobId: result.assistant_message.id, attempts: 3, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: 500 });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Không xếp được hàng đợi AI';
      this.logger.error(`Không xếp được việc AI cho tin ${result.assistant_message.id}: ${reason}`);
      await this.prisma.aiMessage.update({
        where: { id: result.assistant_message.id },
        data: { status: AiMessageStatus.FAILED, errorMessage: reason, completedAt: new Date() },
      });
      /* Gắn `code` vì 503 ở đây khác hẳn 503 của nhà cung cấp AI: lần này
         chưa có gì được gửi đi, gửi lại là chạy ngay khi hàng đợi sống lại. */
      throw new ServiceUnavailableException({
        message: 'Trợ lý AI tạm thời không nhận thêm yêu cầu, vui lòng thử lại',
        code: 'AI_QUEUE_UNAVAILABLE',
      });
    }
    return result;
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

  async processMessage(messageId: string) {
    const message = await this.prisma.aiMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { expert: true } } },
    });
    if (!message || message.status === AiMessageStatus.COMPLETED) return message;
    const input = await this.prisma.aiMessage.findFirst({
      where: { conversationId: message.conversationId, role: AiMessageRole.USER, createdAt: { lte: message.createdAt } },
      orderBy: { createdAt: 'desc' },
    });
    if (!input) throw new NotFoundException('Không tìm thấy yêu cầu AI');
    const metadata = (message.metadata ?? {}) as Record<string, unknown>;
    try {
      const generated = await this.provider.generate(message.conversation.expert, message.kind, input.content, String(metadata.targetLanguage ?? ''));
      return await this.prisma.aiMessage.update({
        where: { id: message.id },
        data: { status: AiMessageStatus.COMPLETED, content: generated.content, attachmentUrl: generated.attachmentUrl, metadata: generated.metadata as Prisma.InputJsonValue | undefined, completedAt: new Date(), errorMessage: null },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'AI provider error';
      await this.prisma.aiMessage.update({ where: { id: message.id }, data: { status: AiMessageStatus.FAILED, errorMessage: reason, completedAt: new Date() } });
      throw error;
    }
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
