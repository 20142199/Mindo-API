import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { ChatPresenceService } from './chat-presence.service';
import { ChatService } from './chat.service';

/**
 * Thu hồi phải với được cả những chỗ ĐÃ SAO CHÉP nội dung (2026-09-27).
 *
 * Trả lời một tin thì `buildQuotedSnapshot` chụp lại nội dung tin gốc vào
 * `quotedMessageSnapshot` của tin trả lời — cố ý, để ô trích dẫn không phải
 * truy ngược và vẫn đọc được khi tin gốc trôi xa. Nhưng `deleteMessage` chỉ
 * xoá `content` trên chính tin gốc, nên bản sao trong ô trích dẫn vẫn còn:
 * thu hồi xong mà chữ vẫn đọc được thì coi như chưa thu hồi.
 *
 * Chữa lúc ĐỌC chứ không lúc ghi. Chữa lúc ghi thì phải đi sửa mọi tin đã trả
 * lời và vẫn bỏ sót những bản ghi có sẵn trong CSDL; chữa lúc đọc thì một chỗ
 * lo hết, kể cả dữ liệu cũ.
 */

const files = {} as FileStorageService;
const presence = {} as ChatPresenceService;

const RECALLED = 'Tin nhắn đã được thu hồi';

function serviceWith(prisma: Partial<PrismaService>) {
  return new ChatService(prisma as PrismaService, files, presence);
}

const snapshot = {
  kind: 'REPLY',
  source_message_id: 'm-goc',
  source_sender_name: 'Anna Nguyễn',
  source_message_type: 'TEXT',
  content_preview: 'Số tài khoản của tôi là 123456789',
  attachment_file_id: 'f-1',
};

const reply = {
  id: 'm-tra-loi',
  conversationId: 'c-1',
  senderId: 'u-me',
  type: 'TEXT',
  content: 'Đã nhận nhé',
  attachments: null,
  replyToId: 'm-goc',
  quotedMessageSnapshot: snapshot,
  linkPreview: null,
  callInfo: null,
  clientMessageId: null,
  editedAt: null,
  deletedAt: null,
  createdAt: new Date('2026-09-27T07:00:00.000Z'),
  sender: null,
};

/** `recalled` liệt kê id các tin gốc ĐÃ bị thu hồi */
function view(recalled: string[], row: Record<string, unknown> = reply) {
  const findMany = vi
    .fn()
    .mockResolvedValue(recalled.map((id) => ({ id })));
  const service = serviceWith({
    chatMessage: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(row),
      findMany,
    },
    savedChatMessage: { findMany: vi.fn().mockResolvedValue([]) },
    fileUpload: { findMany: vi.fn().mockResolvedValue([]) },
  } as never);
  return { result: service.messageView('u-me', 'm-tra-loi'), findMany };
}

describe('trích dẫn một tin đã bị thu hồi', () => {
  it('không còn đọc được nội dung cũ', async () => {
    const { result } = view(['m-goc']);

    const quote = (await result).quoted_message as Record<string, unknown>;
    expect(quote.content_preview).toBe(RECALLED);
  });

  /* Ảnh cũng là nội dung. Giữ `attachment_file_id` lại là để ngỏ một đường
     tải đúng tấm ảnh người ta vừa bảo xoá. */
  it('không để lại đường lấy ảnh đính kèm', async () => {
    const { result } = view(['m-goc']);

    const quote = (await result).quoted_message as Record<string, unknown>;
    expect(quote.attachment_file_id).toBeUndefined();
  });

  /* Tên người bị trích vẫn giữ: nó không phải nội dung, và bỏ đi thì ô trích
     dẫn thành một mẩu trống không rõ đang nói về ai. */
  it('vẫn biết đang trả lời ai', async () => {
    const { result } = view(['m-goc']);

    const quote = (await result).quoted_message as Record<string, unknown>;
    expect(quote.source_sender_name).toBe('Anna Nguyễn');
    expect(quote.source_message_id).toBe('m-goc');
  });
});

describe('tin gốc còn nguyên', () => {
  it('giữ đúng ảnh chụp lúc gửi', async () => {
    const { result } = view([]);

    expect((await result).quoted_message).toEqual(snapshot);
  });
});

describe('không hỏi CSDL thừa', () => {
  it('tin không trả lời ai thì bỏ hẳn truy vấn', async () => {
    const { result, findMany } = view([], { ...reply, replyToId: null, quotedMessageSnapshot: null });

    await result;

    expect(findMany).not.toHaveBeenCalled();
  });
});
