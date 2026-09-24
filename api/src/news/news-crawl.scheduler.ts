import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { NEWS_CRAWL_DUE_JOB, NEWS_CRAWL_QUEUE } from './news-crawl.constants';

@Injectable()
export class NewsCrawlScheduler implements OnModuleInit {
  constructor(@InjectQueue(NEWS_CRAWL_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    if (process.env.NEWS_CRAWL_ENABLED === 'false') return;
    await this.queue.upsertJobScheduler('mindo-news-html-crawler', { every: 5 * 60_000 }, { name: NEWS_CRAWL_DUE_JOB, data: {}, opts: { removeOnComplete: 50, removeOnFail: 100 } });
  }
}
