import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../common/prisma.module';

/**
 * Nhịp tim của một tiến trình server, giây.
 *
 * Tiến trình còn sống thì cứ nửa nhịp lại gia hạn khoá của mình. Chết thì
 * khoá hết hạn, và những socket nó bỏ lại bị quét đi ở lần khởi động sau.
 */
const NODE_TTL = 60;

/** Kết quả của một lần ngắt kết nối — xem `disconnect` */
export interface PresenceDeparture {
  /** Đây có phải socket CUỐI CÙNG của người này không */
  wasLast: boolean;
  /** Mốc vừa ghi, ISO; `null` nếu họ còn thiết bị khác đang mở */
  lastSeenAt: string | null;
}

@Injectable()
export class ChatPresenceService implements OnModuleDestroy {
  private readonly logger = new Logger(ChatPresenceService.name);
  private readonly redis = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  private connected = false;
  /** Định danh của CHÍNH tiến trình này, sinh mới mỗi lần chạy */
  private readonly nodeId = randomUUID();
  private heartbeat?: ReturnType<typeof setInterval>;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dọn rác của những tiến trình đã chết, rồi bắt đầu nhịp tim của mình.
   *
   * Vì sao cần: tập socket trong Redis chỉ được gỡ ở handler `disconnect`.
   * Server bị kill -9, crash, hay chỉ là khởi động lại lúc dev — handler đó
   * không chạy, và mọi socket đang mở nằm lại trong Redis nguyên một ngày
   * (TTL 86400).
   *
   * Hậu quả không phải là một chấm xanh thừa. Nó làm HỎNG HẲN presence của
   * người đó: `SCARD` không bao giờ còn bằng 1 nên không ai được báo là họ
   * vừa online, và cũng không bao giờ về 0 nên không ai được báo là họ đã
   * offline. Trên máy dev của chủ dự án, một tài khoản đã tích được 30 id
   * rác theo đúng cách này.
   *
   * Mỗi thành viên vì thế mang theo id tiến trình đã ghi nó: `<nodeId>|<socketId>`.
   * Tiến trình nào không còn khoá nhịp tim là đã chết, và phần nó bỏ lại
   * quét đi được. Id kiểu cũ (không có `|`) cũng rơi vào diện này, nên rác
   * cũ tự sạch ở lần chạy đầu tiên sau thay đổi.
   */
  async start() {
    await this.safe(async () => {
      await this.redis.set(this.nodeKey(this.nodeId), '1', 'EX', NODE_TTL);
      await this.sweepDeadNodes();
    });

    this.heartbeat = setInterval(() => {
      void this.safe(async () => {
        await this.redis.set(this.nodeKey(this.nodeId), '1', 'EX', NODE_TTL);
      });
    }, (NODE_TTL / 2) * 1000);
    /* Đừng giữ tiến trình sống chỉ vì một cái hẹn giờ. */
    this.heartbeat.unref?.();
  }

  private nodeKey(nodeId: string) {
    return `mindo:chat:node:${nodeId}`;
  }

  /** `<nodeId>|<socketId>` — xem `start` */
  private member(socketId: string) {
    return `${this.nodeId}|${socketId}`;
  }

  private async sweepDeadNodes() {
    const keys = await this.redis.keys('mindo:chat:online:*');
    if (!keys.length) return;

    /* Hỏi tình trạng mỗi tiến trình ĐÚNG MỘT LẦN, không hỏi lại cho từng
       socket — một tiến trình chết có thể bỏ lại hàng trăm id. */
    const alive = new Map<string, boolean>();
    let swept = 0;

    for (const key of keys) {
      const members = await this.redis.smembers(key);
      const dead: string[] = [];
      for (const entry of members) {
        const nodeId = entry.split('|')[0];
        if (!alive.has(nodeId)) {
          alive.set(nodeId, (await this.redis.exists(this.nodeKey(nodeId))) === 1);
        }
        if (!alive.get(nodeId)) dead.push(entry);
      }
      if (!dead.length) continue;
      await this.redis.srem(key, ...dead);
      swept += dead.length;
      if ((await this.redis.scard(key)) === 0) await this.redis.del(key);
    }

    if (swept) this.logger.log(`Đã quét ${swept} socket bỏ lại bởi tiến trình đã chết`);
  }

  /**
   * @returns `true` nếu đây là socket ĐẦU TIÊN của người này.
   *
   * Người ta mở app trên cả điện thoại lẫn iPad là hai socket. Chỉ lần đầu
   * mới là tin mới đáng báo cho bạn bè; những lần sau họ đã online rồi.
   *
   * Redis hỏng thì trả `false` — không báo gì còn hơn báo sai.
   */
  async connect(userId: string, socketId: string): Promise<boolean> {
    let first = false;
    await this.safe(async () => {
      const key = `mindo:chat:online:${userId}`;
      await this.redis.sadd(key, this.member(socketId));
      await this.redis.expire(key, 86_400);
      first = (await this.redis.scard(key)) === 1;
    });
    return first;
  }

  /**
   * Gỡ một socket, và nếu là cái cuối cùng thì ghi mốc "lần cuối online".
   *
   * Mốc chỉ ghi khi socket CUỐI rời đi: còn một thiết bị nào đó đang mở thì
   * người ta vẫn đang online, ghi mốc lúc đó là nói dối về một người đang
   * ngồi ngay đấy.
   */
  async disconnect(userId: string, socketId: string): Promise<PresenceDeparture> {
    let wasLast = false;
    await this.safe(async () => {
      const key = `mindo:chat:online:${userId}`;
      await this.redis.srem(key, this.member(socketId));
      if ((await this.redis.scard(key)) === 0) {
        await this.redis.del(key);
        wasLast = true;
      }
    });

    if (!wasLast) return { wasLast: false, lastSeenAt: null };

    const lastSeenAt = new Date();
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt } });
    } catch (error) {
      /* Mất mốc thì app hiện "offline" không kèm thời gian — xấu nhưng không
         sai. Ném ra đây sẽ kéo đổ cả luồng ngắt kết nối. */
      this.logger.warn(`Không ghi được lastSeenAt của ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { wasLast: true, lastSeenAt: lastSeenAt.toISOString() };
  }

  async onlineMap(userIds: string[]) {
    const unique = [...new Set(userIds)];
    const result = new Map(unique.map((id) => [id, false]));
    await this.safe(async () => {
      const pipeline = this.redis.pipeline();
      unique.forEach((id) => pipeline.scard(`mindo:chat:online:${id}`));
      const rows = await pipeline.exec();
      rows?.forEach((row, index) => result.set(unique[index], !row[0] && Number(row[1]) > 0));
    });
    return result;
  }

  async onModuleDestroy() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    /* Bỏ khoá nhịp tim đi thì lần khởi động sau quét được phần mình để lại,
       kể cả khi lần này tắt không kịp gỡ từng socket. */
    await this.safe(async () => {
      await this.redis.del(this.nodeKey(this.nodeId));
    });
    if (this.connected) await this.redis.quit().catch(() => undefined);
  }

  private async ensureConnected() {
    if (this.connected) return;
    await this.redis.connect();
    this.connected = true;
  }

  private async safe(work: () => Promise<void>) {
    try {
      await this.ensureConnected();
      await work();
    } catch (error) {
      this.logger.warn(`Redis presence tạm thời không khả dụng: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
