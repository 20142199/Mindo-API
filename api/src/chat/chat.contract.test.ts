import {
  ChatMessageType,
  ConversationMemberRole,
  ConversationType,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { ChatPresenceService } from './chat-presence.service';
import { ChatService } from './chat.service';

/**
 * Safety net for the chat wire contract (2026-09-25).
 *
 * Everything here is about what the serializers put on the wire, which is the
 * part no other test touches and the part a client is written against.
 *
 * Two of the three rules below were broken in the same way: a value existed
 * in the database and was either reshaped on the way out or left out
 * entirely, so the client could not reconstruct it.
 *
 *   1. Enums were lowercased on responses while requests had to send them
 *      exactly as declared. `TEXT` went out as `text`, and a client that
 *      echoed back what it received got a validation error.
 *   2. `ConversationMember.lastReadMessageId` is stored on every read but was
 *      never serialized. The `message:read` socket event covers a live
 *      session; nothing covered reopening the app, so every previously seen
 *      message lost its read mark.
 *
 * Both are cheap to reintroduce by "tidying" a serializer, and neither shows
 * up as a crash — the client just quietly renders the wrong thing.
 */

const peer = {
  id: 'user-peer',
  fullName: 'Anna Nguyễn',
  nickname: null,
  avatarFileId: null,
};

const me = {
  id: 'user-me',
  fullName: 'Nguyễn Hồng Sơn',
  nickname: null,
  avatarFileId: null,
};

const lastMessage = {
  id: 'message-9',
  conversationId: 'conversation-1',
  senderId: peer.id,
  type: ChatMessageType.IMAGE,
  content: null,
  attachments: null,
  clientMessageId: null,
  replyToId: null,
  quotedMessageSnapshot: null,
  editedAt: null,
  deletedAt: null,
  createdAt: new Date('2026-09-25T10:00:00.000Z'),
  updatedAt: new Date('2026-09-25T10:00:00.000Z'),
  sender: peer,
};

function conversationRow(over: Record<string, unknown> = {}) {
  return {
    id: 'conversation-1',
    type: ConversationType.GROUP,
    directKey: null,
    title: 'Nhóm đầu tư',
    avatarFileId: null,
    createdById: me.id,
    lastMessageAt: new Date('2026-09-25T10:00:00.000Z'),
    deletedAt: null,
    createdAt: new Date('2026-09-20T08:00:00.000Z'),
    updatedAt: new Date('2026-09-25T10:00:00.000Z'),
    members: [
      {
        conversationId: 'conversation-1',
        userId: me.id,
        role: ConversationMemberRole.OWNER,
        isMuted: false,
        isHidden: false,
        lastReadMessageId: 'message-9',
        lastReadAt: new Date('2026-09-25T10:05:00.000Z'),
        joinedAt: new Date('2026-09-20T08:00:00.000Z'),
        leftAt: null,
        user: me,
      },
      {
        conversationId: 'conversation-1',
        userId: peer.id,
        role: ConversationMemberRole.MEMBER,
        isMuted: false,
        isHidden: false,
        lastReadMessageId: 'message-4',
        lastReadAt: new Date('2026-09-25T09:00:00.000Z'),
        joinedAt: new Date('2026-09-20T08:01:00.000Z'),
        leftAt: null,
        user: peer,
      },
    ],
    messages: [lastMessage],
    ...over,
  };
}

/** Tin hệ thống mà `createSystemMessage` sẽ ghi xuống */
const systemRow = {
  ...lastMessage,
  id: 'message-10',
  senderId: null,
  sender: null,
  type: ChatMessageType.SYSTEM,
  content: 'Nguyễn Hồng Sơn đã thêm 1 thành viên',
};

function buildService(row = conversationRow()) {
  const prisma = {
    conversationMember: {
      findFirst: () => Promise.resolve(row.members[0]),
      createMany: () => Promise.resolve({ count: 1 }),
      updateMany: () => Promise.resolve({ count: 1 }),
    },
    conversation: {
      findFirst: () => Promise.resolve(row),
      findUnique: () => Promise.resolve(row),
      update: () => Promise.resolve(row),
    },
    chatMessage: {
      count: () => Promise.resolve(3),
      create: () => Promise.resolve(systemRow),
    },
    friendship: { count: () => Promise.resolve(1) },
    user: { findUnique: () => Promise.resolve(me) },
    fileUpload: { findMany: () => Promise.resolve([]) },
    savedChatMessage: { findMany: () => Promise.resolve([]) },
  } as unknown as PrismaService;

  const presence = {
    onlineMap: () => Promise.resolve(new Map([[peer.id, true]])),
  } as unknown as ChatPresenceService;

  return new ChatService(prisma, {} as FileStorageService, presence);
}

describe('enums go out exactly as they are declared', () => {
  /*
    The asymmetry is what made this a trap rather than a preference: requests
    are validated with `@IsEnum(ChatMessageType)`, so a client had to send
    `TEXT` and then read back `text` for the very same field.
  */
  it('keeps the conversation type uppercase', async () => {
    const view = await buildService().getConversation(me.id, 'conversation-1');

    expect(view.type).toBe(ConversationType.GROUP);
  });

  it('keeps the message type uppercase on the last-message preview', async () => {
    const view = await buildService().getConversation(me.id, 'conversation-1');

    expect(view.last_message?.message_type).toBe(ChatMessageType.IMAGE);
  });

  it('keeps member roles uppercase', async () => {
    const view = await buildService().getConversation(me.id, 'conversation-1');

    expect(view.members?.map((member) => member.role)).toEqual([
      ConversationMemberRole.OWNER,
      ConversationMemberRole.MEMBER,
    ]);
  });
});

describe('read marks survive a restart', () => {
  /*
    Without this the double tick can only ever be drawn from the live
    `message:read` event, so closing and reopening the app wipes it from
    every message that was already seen.
  */
  it('reports where each member has read up to', async () => {
    const view = await buildService().getConversation(me.id, 'conversation-1');

    expect(view.members?.map((member) => [member.user_id, member.last_read_message_id])).toEqual([
      [me.id, 'message-9'],
      [peer.id, 'message-4'],
    ]);
  });

  it('carries the read timestamp as an ISO string', async () => {
    const view = await buildService().getConversation(me.id, 'conversation-1');

    expect(view.members?.[1].last_read_at).toBe('2026-09-25T09:00:00.000Z');
  });

  /* A member who has never opened the conversation has no mark, and null has
     to survive the trip rather than becoming the epoch or a crash. */
  it('reports null for a member who has never read anything', async () => {
    const row = conversationRow();
    row.members[1].lastReadMessageId = null as never;
    row.members[1].lastReadAt = null as never;

    const view = await buildService(row).getConversation(me.id, 'conversation-1');

    expect(view.members?.[1].last_read_message_id).toBeNull();
    expect(view.members?.[1].last_read_at).toBeNull();
  });
});


describe('a system message has to reach the socket layer', () => {
  /*
    `ChatRealtimeService` already imports `ChatService`, so the service
    cannot reach back to broadcast without a circular import — which is why
    every broadcast in this module lives in the controller. A system message
    therefore has to travel up through the return value, or it never gets
    emitted at all.

    That was the bug. The row was written, `lastMessageAt` moved, and the
    controller's `publishConversation` pushed the new preview to every
    member's conversation list — so the list showed "… đã thêm 1 thành viên"
    while the open conversation showed nothing. Two places on the same screen
    disagreeing, until a reload settled it.
  */
  it('returns the system message alongside the updated conversation', async () => {
    const result = await buildService().addMembers(me.id, 'conversation-1', {
      member_user_ids: ['user-new'],
    });

    expect(result.system_message).toMatchObject({
      message_id: 'message-10',
      message_type: ChatMessageType.SYSTEM,
      content: 'Nguyễn Hồng Sơn đã thêm 1 thành viên',
    });
  });

  /* Nobody sent it, so nobody owns it — the bubble must not render as mine. */
  it('marks the system message as belonging to no one', async () => {
    const result = await buildService().addMembers(me.id, 'conversation-1', {
      member_user_ids: ['user-new'],
    });

    expect(result.system_message.sender).toBeNull();
    expect(result.system_message.is_own).toBe(false);
  });

  it('still returns the conversation itself', async () => {
    const result = await buildService().addMembers(me.id, 'conversation-1', {
      member_user_ids: ['user-new'],
    });

    expect(result.conversation_id).toBe('conversation-1');
  });
});
