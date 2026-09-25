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

  it('rejects attachment messages without files', () => {
    expect(() => parseSocketMessage({
      channelId: 'conversation-1',
      clientMessageId: '21efbc58-c8be-4bc4-a942-1bd10e9d5f4c',
      messageType: 'IMAGE',
    })).toThrow('cần tệp đính kèm');
  });
});
