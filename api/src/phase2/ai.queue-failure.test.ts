import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { AiMessageStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { AiProviderService } from './ai-provider.service';
import { AiService } from './ai.service';
import { CreateAiMessageDto } from './phase2.dto';

/**
 * Safety net for the AI enqueue failure path (2026-09-24).
 *
 * `sendMessage` writes the user message and a PENDING assistant message in
 * one transaction, and only then hands the work to BullMQ. Those two steps
 * cannot share an atomic boundary, so the gap between them is real: when the
 * queue refuses the job, the PENDING row is already committed.
 *
 * Nothing else in the system retires that row. `processMessage` is what marks
 * a message FAILED, and it only ever runs from a job that, in this case, was
 * never created. So the row stays PENDING for good, and two things follow
 * from it:
 *
 *   - the app shows a spinner that never resolves, on every later visit to
 *     that conversation;
 *   - `SSE /events` keeps its `takeWhile` open on "some message is PENDING"
 *     and re-reads the whole conversation once a second for as long as the
 *     client stays connected.
 *
 * Deleting the messages instead would be the other defensible choice, but it
 * throws away what the user typed. Marking the answer FAILED keeps the text
 * and gives the conversation an ending.
 */

const expert = { id: 'expert-1', name: 'An Nhiên', capabilities: ['CHAT'], isActive: true };

const conversation = { id: 'conv-1', userId: 'user-1', expertId: expert.id, title: 'Chat', expert, messages: [] };

/** The row the transaction committed before the queue was ever asked. */
const assistantMessage = { id: 'msg-assistant', conversationId: conversation.id, status: AiMessageStatus.PENDING };

function buildService(queueAdd: () => Promise<unknown>) {
  const updates: { where: unknown; data: Record<string, unknown> }[] = [];

  const tx = {
    aiMessage: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(data.role === 'USER' ? { id: 'msg-user', ...data } : assistantMessage)),
    },
    aiConversation: { update: vi.fn(() => Promise.resolve(conversation)) },
  };

  const prisma = {
    aiConversation: { findFirst: () => Promise.resolve(conversation) },
    aiMessage: {
      count: () => Promise.resolve(0),
      update: vi.fn((args: { where: unknown; data: Record<string, unknown> }) => {
        updates.push(args);
        return Promise.resolve({ ...assistantMessage, ...args.data });
      }),
    },
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaService;

  const queue = { add: vi.fn(queueAdd) } as unknown as Queue;

  const service = new AiService(
    prisma,
    {} as AiProviderService,
    {} as FileStorageService,
    queue,
  );

  return { service, queue, updates };
}

const dto = { content: 'Chào bạn' } as CreateAiMessageDto;

beforeEach(() => {
  // Nest logs the failure at error level; keep the test output readable.
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('sendMessage when the job queue is unreachable', () => {
  it('does not leave the assistant message PENDING', async () => {
    const { service, updates } = buildService(() => Promise.reject(new Error('Redis connection refused')));

    await expect(service.sendMessage('user-1', 'conv-1', dto)).rejects.toThrow(ServiceUnavailableException);

    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({ id: assistantMessage.id });
    expect(updates[0].data.status).toBe(AiMessageStatus.FAILED);
  });

  it('closes the message off so the SSE stream can end', async () => {
    const { service, updates } = buildService(() => Promise.reject(new Error('Redis connection refused')));

    await service.sendMessage('user-1', 'conv-1', dto).catch(() => undefined);

    // `completedAt` is what separates "finished badly" from "still running".
    expect(updates[0].data.completedAt).toBeInstanceOf(Date);
    expect(updates[0].data.errorMessage).toBe('Redis connection refused');
  });

  it('answers 503 with a code the app can act on, not a bare 500', async () => {
    const { service } = buildService(() => Promise.reject(new Error('Redis connection refused')));

    const error = await service.sendMessage('user-1', 'conv-1', dto).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({ code: 'AI_QUEUE_UNAVAILABLE' });
  });

  it('leaves the happy path alone', async () => {
    const { service, queue, updates } = buildService(() => Promise.resolve({ id: 'job-1' }));

    const result = await service.sendMessage('user-1', 'conv-1', dto);

    expect(queue.add).toHaveBeenCalledOnce();
    expect(result.assistant_message).toEqual(assistantMessage);
    // Nothing to repair, so nothing may be written after the transaction.
    expect(updates).toHaveLength(0);
  });
});
