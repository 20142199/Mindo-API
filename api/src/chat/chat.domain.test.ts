import { ChatMessageType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { directConversationKey, messagePreview, parseSocketMessage } from './chat.domain';

describe('chat domain', () => {
  it('builds the same direct key regardless of member order', () => {
    expect(directConversationKey('user-a', 'user-b')).toBe(directConversationKey('user-b', 'user-a'));
  });

  it('uses localized previews for attachments', () => {
    expect(messagePreview(ChatMessageType.IMAGE)).toBe('Đã gửi một hình ảnh');
    expect(messagePreview(ChatMessageType.FILE)).toBe('Đã gửi một tệp');
  });

  it('accepts a valid socket message and trims its content', () => {
    expect(parseSocketMessage({
      channelId: 'conversation-1',
      clientMessageId: '21efbc58-c8be-4bc4-a942-1bd10e9d5f4c',
      messageType: 'TEXT',
      content: '  Xin chào  ',
    }).content).toBe('Xin chào');
  });

  /*
    The socket payload used to call this `parentMessageId` while REST called
    the same thing `reply_to_message_id`. The docs tell the app to use both
    paths — socket first, REST as the fallback when the socket is down — so
    the two names meant every client had to carry two shapes for one action,
    and picking the wrong one silently dropped the reply link.
  */
  it('reads the reply link under the same name REST uses', () => {
    expect(parseSocketMessage({
      channelId: 'conversation-1',
      clientMessageId: '21efbc58-c8be-4bc4-a942-1bd10e9d5f4c',
      messageType: 'TEXT',
      content: 'Vâng đúng rồi',
      replyToMessageId: '  message-7  ',
    }).replyToMessageId).toBe('message-7');
  });

  it('leaves the reply link empty when there is none', () => {
    expect(parseSocketMessage({
      channelId: 'conversation-1',
      clientMessageId: '21efbc58-c8be-4bc4-a942-1bd10e9d5f4c',
      messageType: 'TEXT',
      content: 'Xin chào',
    }).replyToMessageId).toBeUndefined();
  });

  it('rejects attachment messages without files', () => {
    expect(() => parseSocketMessage({
      channelId: 'conversation-1',
      clientMessageId: '21efbc58-c8be-4bc4-a942-1bd10e9d5f4c',
      messageType: 'IMAGE',
    })).toThrow('cần tệp đính kèm');
  });
});
