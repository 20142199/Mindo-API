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
