import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

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

  async connect(userId: string, socketId: string) {
    await this.safe(async () => {
      const key = `mindo:chat:online:${userId}`;
      await this.redis.sadd(key, socketId);
      await this.redis.expire(key, 86_400);
    });
  }

  async disconnect(userId: string, socketId: string) {
    await this.safe(async () => {
      const key = `mindo:chat:online:${userId}`;
      await this.redis.srem(key, socketId);
      if ((await this.redis.scard(key)) === 0) await this.redis.del(key);
    });
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
