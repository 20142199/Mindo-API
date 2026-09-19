import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { AiMessageKind, AiMessageRole, AiMessageStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { AiProviderService } from './ai-provider.service';
import { CreateAiConversationDto, CreateAiMessageDto, UpsertAiExpertDto } from './phase2.dto';

@Injectable()
export class AiService {
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

  listConversations(userId: string) {
    return this.prisma.aiConversation.findMany({
      where: { userId },
      include: { expert: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
    });
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
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dailyUsed = await this.prisma.aiMessage.count({ where: { conversation: { userId }, role: AiMessageRole.USER, createdAt: { gte: dayStart } } });
    if (dailyUsed >= Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 50)) throw new BadRequestException('Đã đạt giới hạn yêu cầu AI trong ngày');
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
    await this.queue.add('generate', { messageId: result.assistant_message.id }, { jobId: result.assistant_message.id, attempts: 3, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: 500 });
    return result;
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
