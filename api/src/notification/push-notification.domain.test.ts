import { describe, expect, it } from 'vitest';
import { chatPushMessage, incomingCallPushMessage, isDeadFirebaseTarget, withdrawalPushMessage } from './push-notification.domain';

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

  it('builds a successful withdrawal notification for the transaction channel', () => {
    const message = withdrawalPushMessage(['token-1'], {
      withdrawalId: 'withdrawal-1', amountVnd: '250000', status: 'APPROVED',
    });
    expect(message.notification).toEqual({
      title: 'Rút tiền thành công',
      body: 'Tiền đã được chuyển đến tài khoản ngân hàng của bạn.',
    });
    expect(message.data).toMatchObject({ type: 'withdrawal_result', withdrawal_status: 'approved', amount_vnd: '250000' });
    expect(message.android?.notification?.channelId).toBe('mindo_transactions');
  });
});
