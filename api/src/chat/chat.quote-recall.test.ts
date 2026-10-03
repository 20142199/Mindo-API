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
 *
 * Từ 2026-10-03 lúc đọc lấy luôn nội dung SỐNG của tin gốc chứ không chỉ hỏi
 * "đã thu hồi chưa": tin gốc sửa rồi mà ô trích dẫn vẫn hiện chữ cũ thì người
 * đọc tin trả lời hiểu sai điều đang được trả lời. Kèm `source_sender_id` để
 * app tự hiện "Bạn" hay tên gợi nhớ thay cho tên chụp sẵn.
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

/** Tin gốc như `serializeMessages` đọc lên — đủ để dựng ô trích dẫn sống */
type SourceRow = { id: string; senderId: string | null; type: string; content: string | null; deletedAt: Date | null };

const liveSource: SourceRow = {
  id: 'm-goc',
  senderId: 'u-anna',
  type: 'TEXT',
  content: 'Số tài khoản của tôi là 123456789',
  deletedAt: null,
};
const recalledSource: SourceRow = { ...liveSource, content: null, deletedAt: new Date('2026-09-27T08:00:00.000Z') };

/** `sources` là các tin gốc CÒN dòng trong CSDL (đã thu hồi hay chưa) */
function view(sources: SourceRow[], row: Record<string, unknown> = reply) {
  const findMany = vi.fn().mockResolvedValue(sources);
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

async function quoteOf(result: Promise<{ quoted_message: unknown }>) {
  return (await result).quoted_message as Record<string, unknown>;
}

describe('trích dẫn một tin đã bị thu hồi', () => {
  it('không còn đọc được nội dung cũ', async () => {
    const quote = await quoteOf(view([recalledSource]).result);

    expect(quote.content_preview).toBe(RECALLED);
    /* Cờ riêng để app không phải so chuỗi tiếng Việt mới biết là đã thu hồi. */
    expect(quote.recalled).toBe(true);
  });

  /* Ảnh cũng là nội dung. Giữ `attachment_file_id` lại là để ngỏ một đường
     tải đúng tấm ảnh người ta vừa bảo xoá. */
  it('không để lại đường lấy ảnh đính kèm', async () => {
    const quote = await quoteOf(view([recalledSource]).result);

    expect(quote.attachment_file_id).toBeUndefined();
  });

  /* Tên người bị trích vẫn giữ: nó không phải nội dung, và bỏ đi thì ô trích
     dẫn thành một mẩu trống không rõ đang nói về ai. */
  it('vẫn biết đang trả lời ai', async () => {
    const quote = await quoteOf(view([recalledSource]).result);

    expect(quote.source_sender_name).toBe('Anna Nguyễn');
    expect(quote.source_message_id).toBe('m-goc');
    expect(quote.source_sender_id).toBe('u-anna');
  });

  /* Tin bị xoá mềm nên mất hẳn dòng nghĩa là bị xoá cứng — càng không được
     để bản sao lộ ra. */
  it('tin gốc không còn dòng nào thì cũng che như đã thu hồi', async () => {
    const quote = await quoteOf(view([]).result);

    expect(quote.content_preview).toBe(RECALLED);
    expect(quote.recalled).toBe(true);
    expect(quote.attachment_file_id).toBeUndefined();
    /* Bản chụp cũ không lưu id người viết, tin gốc cũng không còn: null. */
    expect(quote.source_sender_id).toBeNull();
  });

  it('tin gốc không còn thì lấy id người viết từ bản chụp nếu có', async () => {
    const row = { ...reply, quotedMessageSnapshot: { ...snapshot, source_sender_id: 'u-anna' } };

    const quote = await quoteOf(view([], row).result);

    expect(quote.source_sender_id).toBe('u-anna');
  });
});

describe('ô trích dẫn đọc nội dung SỐNG của tin gốc', () => {
  it('tin gốc chưa đổi thì nội dung y như bản chụp, kèm id người viết', async () => {
    const quote = await quoteOf(view([liveSource]).result);

    expect(quote).toEqual({ ...snapshot, source_sender_id: 'u-anna', recalled: false });
  });

  it('tin gốc đã sửa thì hiện chữ mới', async () => {
    const quote = await quoteOf(view([{ ...liveSource, content: 'Số mới là 987654321' }]).result);

    expect(quote.content_preview).toBe('Số mới là 987654321');
    expect(quote.recalled).toBe(false);
    /* Phần không phải nội dung giữ nguyên bản chụp. */
    expect(quote.source_sender_name).toBe('Anna Nguyễn');
    expect(quote.source_message_id).toBe('m-goc');
    expect(quote.attachment_file_id).toBe('f-1');
  });

  /* Phải cắt đúng như lúc chụp (`messagePreview`), không thì tin chưa sửa
     cũng đổi chữ so với bản chụp cũ. */
  it('chữ sửa dài thì cắt như dòng xem trước', async () => {
    const long = 'a'.repeat(120);

    const quote = await quoteOf(view([{ ...liveSource, content: long }]).result);

    expect(quote.content_preview).toBe(`${'a'.repeat(77)}...`);
  });

  /* Tài khoản người viết bị xoá thì `senderId` thành null (SetNull) — còn bản
     chụp thì dùng bản chụp. */
  it('tin gốc mất người viết thì rơi về id trong bản chụp', async () => {
    const row = { ...reply, quotedMessageSnapshot: { ...snapshot, source_sender_id: 'u-anna' } };

    const quote = await quoteOf(view([{ ...liveSource, senderId: null }], row).result);

    expect(quote.source_sender_id).toBe('u-anna');
  });
});

describe('không hỏi CSDL thừa', () => {
  it('tin không trả lời ai thì bỏ hẳn truy vấn', async () => {
    const { result, findMany } = view([], { ...reply, replyToId: null, quotedMessageSnapshot: null });

    expect((await result).quoted_message).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('cả trang chỉ một truy vấn tin gốc, id không lặp, đọc đủ cột cần', async () => {
    const page = [
      { ...reply, id: 'r-3', createdAt: new Date('2026-09-27T07:03:00.000Z') },
      { ...reply, id: 'r-2', createdAt: new Date('2026-09-27T07:02:00.000Z') },
      { ...reply, id: 'r-1', createdAt: new Date('2026-09-27T07:01:00.000Z') },
    ];
    const findMany = vi.fn()
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce([{ ...liveSource, content: 'Đã sửa' }]);
    const service = serviceWith({
      conversationMember: { findFirst: vi.fn().mockResolvedValue({ joinedAt: new Date('2026-09-01T00:00:00.000Z') }) },
      chatMessage: { findMany },
      savedChatMessage: { findMany: vi.fn().mockResolvedValue([]) },
      fileUpload: { findMany: vi.fn().mockResolvedValue([]) },
    } as never);

    const result = await service.listMessages('u-me', 'c-1', { limit: 30 } as never);

    expect(findMany).toHaveBeenCalledTimes(2);
    const sourceQuery = findMany.mock.calls[1][0];
    expect(sourceQuery.where).toEqual({ id: { in: ['m-goc'] } });
    expect(sourceQuery.select).toEqual({ id: true, senderId: true, type: true, content: true, deletedAt: true });
    expect(result.items.map((item) => (item.quoted_message as Record<string, unknown>).content_preview))
      .toEqual(['Đã sửa', 'Đã sửa', 'Đã sửa']);
  });
});

describe('trả lời mới mang sẵn id người viết tin gốc', () => {
  /* `sendMessage` là đường của cả REST lẫn socket `message:send`, và payload
     `message:new` chính là kết quả của nó — nên ô trích dẫn trên socket cũng có
     `source_sender_id` ngay, không phải đợi tải lại. */
  it('ghi id vào bản chụp và trả ra trong payload', async () => {
    const created: Record<string, unknown>[] = [];
    const source = { ...liveSource, conversationId: 'c-1', attachments: null, sender: { fullName: 'Anna Nguyễn', nickname: null } };
    const tx = {
      chatMessage: {
        create: vi.fn((args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return Promise.resolve({ ...reply, quotedMessageSnapshot: args.data.quotedMessageSnapshot });
        }),
      },
      conversation: { update: vi.fn().mockResolvedValue({}) },
      conversationMember: { updateMany: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
    };
    const service = serviceWith({
      conversationMember: { findFirst: vi.fn().mockResolvedValue({ joinedAt: new Date() }) },
      chatMessage: {
        findFirst: vi.fn().mockResolvedValue(source),
        findMany: vi.fn().mockResolvedValue([liveSource]),
      },
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      savedChatMessage: { findMany: vi.fn().mockResolvedValue([]) },
      fileUpload: { findMany: vi.fn().mockResolvedValue([]) },
    } as never);

    const { message } = await service.sendMessage('u-me', 'c-1', {
      message_type: 'TEXT',
      content: 'Đã nhận nhé',
      client_message_id: '21efbc58-c8be-4bc4-a942-1bd10e9d5f4c',
      reply_to_message_id: 'm-goc',
    } as never);

    expect((created[0].quotedMessageSnapshot as Record<string, unknown>).source_sender_id).toBe('u-anna');
    expect((message.quoted_message as Record<string, unknown>).source_sender_id).toBe('u-anna');
  });
});

describe('tin gốc bị xoá cứng', () => {
  /* `replyToId` là `onDelete: SetNull`: xoá cứng tin gốc thì cột đó thành
     null trong khi bản chụp vẫn nguyên chữ. Vẫn phải tra theo id trong bản
     chụp — bỏ qua lần tra là để lộ lại nội dung cũ. */
  it('vẫn tra theo id trong bản chụp và che như đã thu hồi', async () => {
    const { result, findMany } = view([], { ...reply, replyToId: null });

    const quote = await quoteOf(result);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.id.in).toContain('m-goc');
    expect(quote.content_preview).toBe(RECALLED);
    expect(quote.recalled).toBe(true);
    expect(quote.attachment_file_id).toBeUndefined();
  });
});

describe('chính tin trả lời đã bị thu hồi', () => {
  /* Bong bóng đã thu hồi giấu chữ, ảnh, thẻ liên kết — ô trích dẫn cũng là
     một phần của tin đó, để lại là để app có thứ mà vẽ ra. */
  it('không mang ô trích dẫn', async () => {
    const recalledReply = { ...reply, content: null, deletedAt: new Date('2026-09-27T09:00:00.000Z') };

    const view_ = await view([liveSource], recalledReply).result;

    expect(view_.content).toBeNull();
    expect(view_.quoted_message).toBeNull();
  });
});

describe('tin đã lưu của nhóm mình không còn ở trong', () => {
  /* `listSavedMessages` không xét thành viên: tin đã lưu vẫn là của mình. Nhưng
     ô trích dẫn sống thì là cửa sổ nhìn vào hội thoại HIỆN TẠI — đã rời / bị
     xoá khỏi nhóm thì không được thấy tin gốc người ta sửa về sau. Giữ bản
     chụp lúc gửi; thu hồi thì vẫn che. */
  function savedView(sources: SourceRow[], activeConversationIds: string[]) {
    const savedRows = [
      { messageId: 'r-cu', message: { ...reply, id: 'r-cu', conversationId: 'c-da-roi' } },
      { messageId: 'r-moi', message: { ...reply, id: 'r-moi', conversationId: 'c-1' } },
    ];
    const memberFindMany = vi.fn().mockResolvedValue(activeConversationIds.map((conversationId) => ({ conversationId })));
    const service = serviceWith({
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
      savedChatMessage: {
        count: vi.fn().mockResolvedValue(savedRows.length),
        findMany: vi.fn()
          .mockResolvedValueOnce(savedRows)
          .mockResolvedValue(savedRows.map(({ messageId }) => ({ messageId }))),
      },
      conversationMember: { findMany: memberFindMany },
      chatMessage: { findMany: vi.fn().mockResolvedValue(sources) },
      fileUpload: { findMany: vi.fn().mockResolvedValue([]) },
    } as never);
    return { result: service.listSavedMessages('u-me', { page: 1, limit: 20 } as never), memberFindMany };
  }

  it('nhóm đã rời thì giữ chữ chụp lúc gửi, nhóm còn ở thì chữ sống', async () => {
    const { result, memberFindMany } = savedView([{ ...liveSource, content: 'Đã sửa sau khi tôi rời' }], ['c-1']);

    const { data } = await result;
    const [left, active] = data.map((item) => item.quoted_message as Record<string, unknown>);

    expect(memberFindMany.mock.calls[0][0].where).toMatchObject({ userId: 'u-me', leftAt: null });
    expect(left.content_preview).toBe(snapshot.content_preview);
    expect(left.recalled).toBe(false);
    expect(active.content_preview).toBe('Đã sửa sau khi tôi rời');
  });

  it('nhóm đã rời mà tin gốc bị thu hồi thì vẫn che', async () => {
    const { result } = savedView([recalledSource], []);

    const { data } = await result;
    const quote = data[0].quoted_message as Record<string, unknown>;

    expect(quote.content_preview).toBe(RECALLED);
    expect(quote.recalled).toBe(true);
    expect(quote.attachment_file_id).toBeUndefined();
  });
});
