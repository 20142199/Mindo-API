import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NEWS_CRAWL_DUE_JOB, NEWS_CRAWL_QUEUE, NEWS_CRAWL_SOURCE_JOB, NEWS_EDITORIAL_ARTICLE_JOB } from './news-crawl.constants';
import { NewsCrawlService } from './news-crawl.service';

@Processor(NEWS_CRAWL_QUEUE, { concurrency: 1 })
export class NewsCrawlProcessor extends WorkerHost {
  constructor(private readonly crawler: NewsCrawlService) { super(); }

  process(job: Job<{ sourceId?: string; articleId?: string }>) {
    if (job.name === NEWS_CRAWL_SOURCE_JOB && job.data.sourceId) return this.crawler.crawlSource(job.data.sourceId);
    if (job.name === NEWS_CRAWL_DUE_JOB) return this.crawler.crawlDueSources();
    if (job.name === NEWS_EDITORIAL_ARTICLE_JOB && job.data.articleId) return this.crawler.editorializeArticleById(job.data.articleId);
    return Promise.resolve({ ignored: true });
  }
}
