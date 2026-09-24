import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminNewsController, NewsController } from './news.controller';
import { NewsService } from './news.service';
import { OptionalJwtGuard } from './optional-jwt.guard';
import { NEWS_CRAWL_QUEUE } from './news-crawl.constants';
import { NewsCrawlProcessor } from './news-crawl.processor';
import { NewsCrawlScheduler } from './news-crawl.scheduler';
import { NewsCrawlService } from './news-crawl.service';

@Module({
  imports: [AuthModule, BullModule.registerQueue({ name: NEWS_CRAWL_QUEUE })],
  controllers: [NewsController, AdminNewsController],
  providers: [NewsService, OptionalJwtGuard, NewsCrawlService, NewsCrawlProcessor, NewsCrawlScheduler],
})
export class NewsModule {}
