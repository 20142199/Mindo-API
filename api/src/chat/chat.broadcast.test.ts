import { describe, expect, it, vi } from 'vitest';
import { ChatRealtimeService } from './chat-realtime.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.module';
import { ChatService } from './chat.service';
import { ChatPresenceService } from './chat-presence.service';
import { PushNotificationService } from '../notification/push-notification.service';

/**
 * Safety net for what a broadcast may carry (2026-09-26).
 *
 * Found by running two real accounts against this server: a message from the
 * other person arrived on the right-hand side of the screen, in the sender's
 * own colour, as though the reader had typed it.
 *
 * `is_own` answers "is this message yours", which only has meaning when there
 * is exactly one asker — a REST response. A broadcast has no asker. The
 * payload is built from the sender's perspective, so sending it unchanged
 * tells every device in the room that the message is theirs.
 *
 * `conversation:updated` had it right all along: it serializes per recipient.
 * That is also why this was hard to spot — the list outside the conversation
 * looked perfectly correct while the thread inside did not.
 */

function buildService() {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  /* Chỉ `namespace` được dùng trong đường đi này; các phụ thuộc còn lại để
     rỗng cho khỏi phải dựng cả nửa ứng dụng. */
  const service = new ChatRealtimeService(
    {} as JwtService,
    {} as PrismaService,
    {} as ChatService,
    {} as ChatPresenceService,
    {} as PushNotificationService,
  );
  (service as unknown as { namespace: unknown }).namespace = { to };
  return { service, to, emit };
}

const message = {
  message_id: 'm-1',
  conversation_id: 'c-1',
  sender: { user_id: 'u-sender', full_name: 'Sender' },
  is_own: true, // built from the sender's point of view
  message_type: 'TEXT',
  content: 'Xin chào',
};

describe('a broadcast carries no viewer-relative claim', () => {
  it('drops is_own from message:new', () => {
    const { service, emit } = buildService();

    (service as unknown as {
      emitMessage: (e: string, c: string, m: Record<string, unknown>) => void;
    }).emitMessage('message:new', 'c-1', message);

    const payload = emit.mock.calls[0][1].message;
    expect('is_own' in payload).toBe(false);
  });

  /* Everything else has to survive — the client still needs the message */
  it('keeps the rest of the message intact', () => {
    const { service, emit } = buildService();

    (service as unknown as {
      emitMessage: (e: string, c: string, m: Record<string, unknown>) => void;
    }).emitMessage('message:new', 'c-1', message);

    expect(emit.mock.calls[0][1].message).toMatchObject({
      message_id: 'm-1',
      content: 'Xin chào',
      sender: { user_id: 'u-sender' },
    });
  });

  it('sends to the conversation room, not to one user', () => {
    const { service, to } = buildService();

    (service as unknown as {
      emitMessage: (e: string, c: string, m: Record<string, unknown>) => void;
    }).emitMessage('message:new', 'c-1', message);

    expect(to).toHaveBeenCalledWith(expect.stringContaining('c-1'));
  });
});
