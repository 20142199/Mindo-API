import { Logger } from '@nestjs/common';
import { AiMessageKind, AiMessageRole, AiMessageStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { AiProviderService } from './ai-provider.service';
import { AiService } from './ai.service';
import { CreateAiMessageDto } from './phase2.dto';

/**
 * Phong cách và tỷ lệ phải nằm trong metadata của TIN TRẢ LỜI:
 *  - `/retry` chạy lại đúng cài đặt mà không cần client gửi lại;
 *  - mở lại phiên từ Lịch sử vẫn biết vẽ khung theo tỷ lệ nào.
 */
const expert = { id: 'e1', name: 'Lam Anh', capabilities: ['CHAT', 'IMAGE'], isActive: true };
const conversation = { id: 'c1', userId: 'u1', expertId: 'e1', title: 'Tạo ảnh', expert, messages: [] };

function sendHarness() {
  const created: Record<string, unknown>[] = [];
  const tx = {
    aiMessage: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({ id: data.role === 'USER' ? 'm-user' : 'm-bot', ...data });
      }),
    },
    aiConversation: { update: vi.fn(() => Promise.resolve(conversation)) },
  };
  const prisma = {
    aiConversation: { findFirst: () => Promise.resolve(conversation) },
    nftAsset: { count: () => Promise.resolve(0) },
    aiMessage: { count: () => Promise.resolve(0), findFirst: () => Promise.resolve(null), update: vi.fn(() => Promise.resolve({})) },
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaService;
  /* Cố ý cho hàng đợi hỏng: hai lệnh create đã chạy xong trước đó, thế là đủ */
  const queue = { add: vi.fn(() => Promise.reject(new Error('stop here'))) } as unknown as Queue;
  const service = new AiService(prisma, {} as AiProviderService, {} as FileStorageService, queue);
  const assistantMetadata = () => created.find((data) => data.role === AiMessageRole.ASSISTANT)?.metadata as Record<string, unknown>;
  return { service, assistantMetadata };
}

beforeEach(() => { vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); });

describe('sendMessage — tuỳ chọn ảnh', () => {
  it('ghi phong cách và tỷ lệ vào metadata của tin trả lời', async () => {
    const { service, assistantMetadata } = sendHarness();
    await service.sendMessage('u1', 'c1', { content: 'robot', kind: AiMessageKind.IMAGE, image_style: 'THREE_D', aspect_ratio: '9:16' } as CreateAiMessageDto).catch(() => undefined);
    expect(assistantMetadata()).toMatchObject({ imageStyle: 'THREE_D', aspectRatio: '9:16' });
  });

  it('thiếu thì ghi mặc định, để phiên luôn đọc ra được một tỷ lệ', async () => {
    const { service, assistantMetadata } = sendHarness();
    await service.sendMessage('u1', 'c1', { content: 'robot', kind: AiMessageKind.IMAGE } as CreateAiMessageDto).catch(() => undefined);
    expect(assistantMetadata()).toMatchObject({ imageStyle: 'AUTO', aspectRatio: '1:1' });
  });

  it('tin chữ không mang hai trường này', async () => {
    const { service, assistantMetadata } = sendHarness();
    await service.sendMessage('u1', 'c1', { content: 'chào', image_style: 'THREE_D' } as CreateAiMessageDto).catch(() => undefined);
    expect(assistantMetadata()).not.toHaveProperty('imageStyle');
    expect(assistantMetadata()).not.toHaveProperty('aspectRatio');
  });
});

const AUTO_TITLE = 'Tạo robot 3D';

function processHarness(overrides: { kind?: AiMessageKind; title?: string; summarize?: () => Promise<string | null> } = {}) {
  const message = {
    id: 'm-bot', conversationId: 'c1', kind: overrides.kind ?? AiMessageKind.IMAGE, status: AiMessageStatus.PENDING,
    createdAt: new Date(), metadata: { imageStyle: 'THREE_D', aspectRatio: '9:16' },
    conversation: { id: 'c1', userId: 'u1', title: overrides.title ?? AUTO_TITLE, expert },
  };
  const input = { id: 'm-user', role: AiMessageRole.USER, content: AUTO_TITLE, metadata: null, createdAt: new Date() };
  const prisma = {
    aiMessage: {
      findUnique: vi.fn().mockResolvedValueOnce(message).mockResolvedValue({ ...message, status: AiMessageStatus.COMPLETED }),
      findFirst: vi.fn().mockResolvedValue(input),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    aiConversation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const provider = {
    generate: vi.fn().mockResolvedValue({ content: 'Ảnh đã được tạo theo yêu cầu.', metadata: { vendor: 'pollinations' } }),
    summarizeTitle: vi.fn(overrides.summarize ?? (() => Promise.resolve('Robot Mindo 3D'))),
  };
  const service = new AiService(prisma as never, provider as never, {} as never, {} as never);
  return { service, prisma, provider };
}

describe('processMessage — ảnh', () => {
  it('truyền phong cách và tỷ lệ từ metadata xuống nhà cung cấp', async () => {
    const { service, provider } = processHarness();
    await service.processMessage('m-bot');
    expect(provider.generate.mock.calls[0][3]).toMatchObject({ imageStyle: 'THREE_D', aspectRatio: '9:16' });
  });

  it('ảnh đầu tiên: đặt tiêu đề ngắn, chỉ khi tiêu đề vẫn là mô tả cắt ngắn', async () => {
    const { service, prisma } = processHarness();
    await service.processMessage('m-bot');
    expect(prisma.aiConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', title: AUTO_TITLE },
      data: { title: 'Robot Mindo 3D' },
    });
  });

  it('người dùng đã đổi tên thì không gọi đặt tên', async () => {
    const { service, provider, prisma } = processHarness({ title: 'Tên tôi tự đặt' });
    await service.processMessage('m-bot');
    expect(provider.summarizeTitle).not.toHaveBeenCalled();
    expect(prisma.aiConversation.updateMany).not.toHaveBeenCalled();
  });

  it('đặt tên hỏng thì ẢNH VẪN XONG', async () => {
    const { service, prisma } = processHarness({ summarize: () => Promise.reject(new Error('down')) });
    await service.processMessage('m-bot');
    const completed = prisma.aiMessage.updateMany.mock.calls.find(([args]) => args.data.status === AiMessageStatus.COMPLETED);
    expect(completed).toBeDefined();
    expect(prisma.aiConversation.updateMany).not.toHaveBeenCalled();
  });

  it('tin chữ không gọi đặt tên', async () => {
    const { service, provider } = processHarness({ kind: AiMessageKind.CHAT });
    await service.processMessage('m-bot');
    expect(provider.summarizeTitle).not.toHaveBeenCalled();
  });
});
