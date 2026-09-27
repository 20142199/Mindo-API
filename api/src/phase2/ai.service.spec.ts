import { AiMessageKind, AiMessageRole, AiMessageStatus } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiService } from './ai.service';

function serviceWith(overrides: Record<string, unknown> = {}) {
  const prisma = {
    aiMessage: {
      count: vi.fn().mockResolvedValue(3),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    aiConversation: { count: vi.fn(), findMany: vi.fn() },
    nftAsset: { count: vi.fn().mockResolvedValue(2) },
    $transaction: vi.fn(),
    ...overrides,
  };
  const queue = { getJobs: vi.fn().mockResolvedValue([]) };
  const service = new AiService(prisma as never, {} as never, {} as never, queue as never);
  return { service, prisma, queue };
}

describe('AiService AI VIP additions', () => {
  const originalEnv = { ...process.env };

  afterEach(() => { process.env = { ...originalEnv }; });

  it('adds the configured Peer bonus to daily usage', async () => {
    process.env.AI_DAILY_MESSAGE_LIMIT = '50';
    process.env.AI_DAILY_LIMIT_PER_PEER = '10';
    const { service } = serviceWith();

    await expect(service.usage('user-1')).resolves.toMatchObject({
      used: 3,
      base_limit: 50,
      peer_owned: 2,
      peer_bonus_limit: 20,
      limit: 70,
      remaining: 67,
      can_use: true,
      timezone: 'Asia/Ho_Chi_Minh',
    });
  });

  it('searches conversations by title or message and filters their kind', async () => {
    const { service, prisma } = serviceWith();
    prisma.$transaction = vi.fn().mockResolvedValue([0, []]);

    await service.listConversations('user-1', { page: 1, limit: 20, q: 'robot', kind: AiMessageKind.IMAGE });

    expect(prisma.aiConversation.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'user-1',
        OR: expect.any(Array),
        messages: { some: { kind: AiMessageKind.IMAGE } },
      }),
    });
  });

  it('marks a pending response as cancelled and removes its queued job', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const { service, prisma, queue } = serviceWith();
    prisma.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      role: AiMessageRole.ASSISTANT,
      status: AiMessageStatus.PENDING,
      metadata: {},
    });
    prisma.aiMessage.updateMany.mockResolvedValue({ count: 1 });
    prisma.aiMessage.findUniqueOrThrow.mockResolvedValue({ id: 'message-1', status: AiMessageStatus.CANCELLED });
    queue.getJobs.mockResolvedValue([{ data: { messageId: 'message-1' }, remove }]);

    await expect(service.stopMessage('user-1', 'message-1')).resolves.toMatchObject({ status: AiMessageStatus.CANCELLED });
    expect(prisma.aiMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'message-1', status: AiMessageStatus.PENDING },
      data: expect.objectContaining({ status: AiMessageStatus.CANCELLED }),
    }));
    expect(remove).toHaveBeenCalledOnce();
  });

  it('exports completed AI documents as a real DOCX zip', async () => {
    const { service, prisma } = serviceWith();
    prisma.aiMessage.findFirst.mockResolvedValue({
      content: '# Kế hoạch\n\n- Việc thứ nhất',
      metadata: { filename: 'ke-hoach.docx' },
    });

    const file = await service.document('user-1', 'message-1');

    expect(file.filename).toBe('ke-hoach.docx');
    expect(file.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(file.content.subarray(0, 2).toString()).toBe('PK');
  });
});
