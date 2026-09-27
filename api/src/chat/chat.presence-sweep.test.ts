import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { ChatPresenceService } from './chat-presence.service';

/**
 * Socket mà tiến trình đã chết bỏ lại phải được quét đi (2026-09-27).
 *
 * Tập socket trong Redis chỉ được gỡ ở handler `disconnect`. Server bị
 * kill -9, crash, hay chỉ là khởi động lại lúc dev thì handler đó không
 * chạy, và mọi socket đang mở nằm lại nguyên một ngày (TTL 86400).
 *
 * Hậu quả không phải một chấm xanh thừa — nó làm HỎNG HẲN presence của
 * người đó. `SCARD` không còn bằng 1 nên không ai được báo họ vừa online,
 * và không bao giờ về 0 nên không ai được báo họ đã offline.
 *
 * Tìm ra bằng cách chạy thật: một tài khoản trên máy dev đã tích 30 id rác
 * đúng theo cách này, và mọi unit test lúc đó vẫn xanh.
 */

/** Redis giả, đủ dùng cho các lệnh mà presence service gọi tới. */
function fakeRedis(seed: Record<string, string[]>, liveNodes: string[] = []) {
  const sets = new Map(Object.entries(seed).map(([k, v]) => [k, new Set(v)]));
  const plain = new Map(liveNodes.map((id) => [`mindo:chat:node:${id}`, '1']));

  return {
    connect: vi.fn(async () => undefined),
    quit: vi.fn(async () => undefined),
    keys: vi.fn(async (pattern: string) => {
      const prefix = pattern.replace('*', '');
      return [...sets.keys()].filter((k) => k.startsWith(prefix));
    }),
    smembers: vi.fn(async (key: string) => [...(sets.get(key) ?? [])]),
    exists: vi.fn(async (key: string) => (plain.has(key) ? 1 : 0)),
    srem: vi.fn(async (key: string, ...members: string[]) => {
      members.forEach((m) => sets.get(key)?.delete(m));
      return members.length;
    }),
    scard: vi.fn(async (key: string) => sets.get(key)?.size ?? 0),
    del: vi.fn(async (key: string) => {
      sets.delete(key);
      plain.delete(key);
      return 1;
    }),
    sadd: vi.fn(async (key: string, member: string) => {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key)!.add(member);
      return 1;
    }),
    expire: vi.fn(async () => 1),
    set: vi.fn(async (key: string) => {
      plain.set(key, '1');
      return 'OK';
    }),
    pipeline: vi.fn(),
    _sets: sets,
  };
}

function build(seed: Record<string, string[]>, liveNodes: string[] = []) {
  const redis = fakeRedis(seed, liveNodes);
  const service = new ChatPresenceService({} as PrismaService);
  const holder = service as unknown as { redis: unknown; connected: boolean };
  holder.redis = redis;
  holder.connected = true;
  return { service, redis };
}

const ONLINE = 'mindo:chat:online:u-me';

describe('quét socket của tiến trình đã chết', () => {
  it('gỡ socket của tiến trình không còn nhịp tim', async () => {
    const { service, redis } = build({ [ONLINE]: ['node-cu|socket-1'] });

    await service.start();

    expect(redis._sets.get(ONLINE)).toBeUndefined();
  });

  /* Rác kiểu CŨ không có dấu `|` — nguyên cả chuỗi bị coi là nodeId, mà
     nodeId đó không có khoá nhịp tim nào, nên cũng bị quét. Nhờ vậy 30 id
     đang nằm sẵn trên máy dev tự sạch ở lần chạy đầu tiên. */
  it('gỡ cả rác kiểu cũ chưa có tiền tố tiến trình', async () => {
    const { service, redis } = build({
      [ONLINE]: ['socket-cu-1', 'socket-cu-2', 'socket-cu-3'],
    });

    await service.start();

    expect(redis._sets.get(ONLINE)).toBeUndefined();
  });

  /* Node khác đang sống thì socket của nó phải được để yên — nếu không, một
     node khởi động lại sẽ đá mọi người đang online trên các node còn lại. */
  it('giữ nguyên socket của tiến trình còn sống', async () => {
    const { service, redis } = build(
      { [ONLINE]: ['node-song|socket-1', 'node-chet|socket-2'] },
      ['node-song'],
    );

    await service.start();

    expect([...(redis._sets.get(ONLINE) ?? [])]).toEqual(['node-song|socket-1']);
  });

  it('không còn ai thì xoá hẳn khoá, không để lại tập rỗng', async () => {
    const { service, redis } = build({ [ONLINE]: ['node-chet|socket-1'] });

    await service.start();

    expect(redis.del).toHaveBeenCalledWith(ONLINE);
  });

  /* Một tiến trình chết bỏ lại hàng trăm socket — hỏi tình trạng của nó một
     lần là đủ, đừng hỏi lại cho từng cái. */
  it('chỉ hỏi tình trạng mỗi tiến trình một lần', async () => {
    const { service, redis } = build({
      [ONLINE]: ['node-a|s1', 'node-a|s2', 'node-a|s3', 'node-b|s4'],
    });

    await service.start();

    const asked = redis.exists.mock.calls.map((c) => c[0]);
    expect(new Set(asked).size).toBe(asked.length);
  });
});

describe('tiền tố tiến trình trong thành viên', () => {
  it('ghi socket kèm id tiến trình, và tự gỡ được chính nó', async () => {
    const { service, redis } = build({});

    const first = await service.connect('u-me', 'socket-1');
    expect(first).toBe(true);
    const [written] = [...(redis._sets.get(ONLINE) ?? [])];
    expect(written).toMatch(/^[0-9a-f-]{36}\|socket-1$/);

    const gone = await service.disconnect('u-me', 'socket-1');
    expect(gone.wasLast).toBe(true);
    expect(redis._sets.get(ONLINE)).toBeUndefined();
  });
});
