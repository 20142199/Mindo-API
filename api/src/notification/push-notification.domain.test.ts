import { describe, expect, it } from 'vitest';
import { chatPushMessage, incomingCallPushMessage, isDeadFirebaseTarget } from './push-notification.domain';

describe('push notification payloads', () => {
  it('builds a navigable chat notification', () => {
    const message = chatPushMessage(['token-1'], {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      senderUserId: 'sender-1',
      senderName: 'An',
      conversationTitle: 'Nhóm Mindo',
      messageType: 'TEXT',
      content: 'Xin chào',
    });
    expect(message.notification).toEqual({ title: 'Nhóm Mindo', body: 'Xin chào' });
    expect(message.data).toMatchObject({ type: 'chat_message', conversation_id: 'conversation-1' });
    expect(message.android?.priority).toBe('high');
  });

  it('builds a high-priority incoming call notification', () => {
    const message = incomingCallPushMessage(['token-1'], {
      callId: 'call-1',
      callerUserId: 'caller-1',
      callerName: 'Bình',
      callType: 'VIDEO',
    });
    expect(message.notification?.title).toBe('Cuộc gọi video đến');
    expect(message.data?.type).toBe('incoming_call');
    expect(message.android?.ttl).toBe(60_000);
  });

  it('recognizes tokens that must be removed', () => {
    expect(isDeadFirebaseTarget('messaging/registration-token-not-registered')).toBe(true);
    expect(isDeadFirebaseTarget('messaging/server-unavailable')).toBe(false);
  });
});
