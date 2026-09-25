import type { MulticastMessage } from 'firebase-admin/messaging';

export type ChatPushInput = {
  conversationId: string;
  messageId: string;
  senderUserId: string;
  senderName: string;
  conversationTitle?: string | null;
  messageType: string;
  content?: string | null;
};

export type IncomingCallPushInput = {
  callId: string;
  callerUserId: string;
  callerName: string;
  callType: string;
  conversationId?: string | null;
};

const pushBody = (messageType: string, content?: string | null) => {
  const value = content?.trim();
  if (value) return value.length > 140 ? `${value.slice(0, 137)}...` : value;
  if (messageType.toUpperCase() === 'IMAGE') return 'Đã gửi một hình ảnh';
  if (messageType.toUpperCase() === 'FILE') return 'Đã gửi một tệp';
  return 'Bạn có tin nhắn mới';
};

export function chatPushMessage(tokens: string[], input: ChatPushInput): MulticastMessage {
  return {
    tokens,
    notification: {
      title: input.conversationTitle?.trim() || input.senderName,
      body: pushBody(input.messageType, input.content),
    },
    data: {
      type: 'chat_message',
      conversation_id: input.conversationId,
      message_id: input.messageId,
      sender_user_id: input.senderUserId,
      message_type: input.messageType.toLowerCase(),
    },
    android: {
      priority: 'high',
      collapseKey: `chat:${input.conversationId}`,
      notification: { channelId: 'mindo_messages', sound: 'default', tag: input.conversationId },
    },
    apns: {
      headers: { 'apns-priority': '10', 'apns-collapse-id': `chat:${input.conversationId}` },
      payload: { aps: { sound: 'default', threadId: input.conversationId } },
    },
  };
}

export function incomingCallPushMessage(tokens: string[], input: IncomingCallPushInput): MulticastMessage {
  return {
    tokens,
    notification: {
      title: input.callType.toUpperCase() === 'VIDEO' ? 'Cuộc gọi video đến' : 'Cuộc gọi thoại đến',
      body: `${input.callerName} đang gọi cho bạn`,
    },
    data: {
      type: 'incoming_call',
      call_id: input.callId,
      caller_user_id: input.callerUserId,
      caller_name: input.callerName,
      call_type: input.callType.toLowerCase(),
      conversation_id: input.conversationId ?? '',
    },
    android: {
      priority: 'high',
      ttl: 60_000,
      collapseKey: `call:${input.callId}`,
      notification: { channelId: 'mindo_calls', sound: 'default', tag: input.callId },
    },
    apns: {
      headers: { 'apns-priority': '10', 'apns-expiration': `${Math.floor(Date.now() / 1000) + 60}` },
      payload: { aps: { sound: 'default', category: 'INCOMING_CALL' } },
    },
  };
}

export function isDeadFirebaseTarget(errorCode?: string) {
  return errorCode === 'messaging/registration-token-not-registered'
    || errorCode === 'messaging/invalid-registration-token'
    || errorCode === 'messaging/installation-id-not-registered';
}
