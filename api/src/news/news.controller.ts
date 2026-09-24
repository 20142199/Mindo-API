import { InjectQueue } from '@nestjs/bullmq';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard, Roles, authUser } from '../auth/auth.guard';
import { ok } from '../common/api-response';
import { ListNewsDto, NewsFeedbackDto, NewsSearchDto, SaveNewsArticleDto, SaveNewsExpertDto, SaveNewsTopicDto, SetNewsInterestsDto, UpdateNewsSourceDto } from './news.dto';
import { NEWS_CRAWL_QUEUE, NEWS_CRAWL_SOURCE_JOB } from './news-crawl.constants';
import { NewsCrawlService } from './news-crawl.service';
import { NewsService } from './news.service';
import { OptionalJwtGuard } from './optional-jwt.guard';

@ApiTags('News')
@Controller('api/v1/news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @UseGuards(OptionalJwtGuard) @Get('home')
  home(@Req() req: AuthenticatedRequest) { return this.news.home(req.user?.id).then((data) => ok(data)); }

  @UseGuards(OptionalJwtGuard) @Get('articles')
  async articles(@Req() req: AuthenticatedRequest, @Query() query: ListNewsDto) {
    const result = await this.news.listArticles(query, req.user?.id);
    return ok(result.data, 'Thành công', result.extra);
  }

  @UseGuards(OptionalJwtGuard) @Get('articles/:idOrSlug')
  article(@Req() req: AuthenticatedRequest, @Param('idOrSlug') idOrSlug: string) { return this.news.article(idOrSlug, req.user?.id).then((data) => ok(data)); }

  @UseGuards(OptionalJwtGuard) @Get('search')
  search(@Req() req: AuthenticatedRequest, @Query() query: NewsSearchDto) { return this.news.search(query.q, query.limit, req.user?.id).then((data) => ok(data)); }

  @Get('topics')
  topics() { return this.news.topics().then((data) => ok(data)); }

  @UseGuards(OptionalJwtGuard) @Get('experts')
  experts(@Req() req: AuthenticatedRequest) { return this.news.experts(req.user?.id).then((data) => ok(data)); }

  @UseGuards(OptionalJwtGuard) @Get('experts/:idOrSlug')
  expert(@Req() req: AuthenticatedRequest, @Param('idOrSlug') idOrSlug: string) { return this.news.expert(idOrSlug, req.user?.id).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('experts/:id/follow')
  follow(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.news.follow(authUser(req).id, id).then((data) => ok(data, 'Đã theo dõi chuyên gia')); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Delete('experts/:id/follow')
  unfollow(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.news.unfollow(authUser(req).id, id).then((data) => ok(data, 'Đã bỏ theo dõi chuyên gia')); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('me')
  me(@Req() req: AuthenticatedRequest) { return this.news.profile(authUser(req).id).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Patch('me/interests')
  interests(@Req() req: AuthenticatedRequest, @Body() dto: SetNewsInterestsDto) { return this.news.setInterests(authUser(req).id, dto.topic_ids).then((data) => ok(data, 'Đã cập nhật lĩnh vực quan tâm')); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('articles/:id/like')
  like(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.news.like(authUser(req).id, id).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Delete('articles/:id/like')
  unlike(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.news.unlike(authUser(req).id, id).then((data) => ok(data)); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('articles/:id/feedback')
  feedback(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: NewsFeedbackDto) { return this.news.feedback(authUser(req).id, id, dto).then((data) => ok(data, 'Đã ghi nhận phản hồi')); }
}

@ApiTags('Admin news')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/admin/news')
export class AdminNewsController {
  constructor(
    private readonly news: NewsService,
    private readonly crawler: NewsCrawlService,
    @InjectQueue(NEWS_CRAWL_QUEUE) private readonly crawlQueue: Queue,
  ) {}

  @Get('articles')
  async articles(@Query() query: ListNewsDto) {
    const result = await this.news.listArticles(query, undefined, true);
    return ok(result.data, 'Thành công', result.extra);
  }

  @Post('articles')
  createArticle(@Body() dto: SaveNewsArticleDto) { return this.news.createArticle(dto).then((data) => ok(data, 'Đã tạo nội dung')); }

  @Patch('articles/:id')
  updateArticle(@Param('id') id: string, @Body() dto: SaveNewsArticleDto) { return this.news.updateArticle(id, dto).then((data) => ok(data, 'Đã cập nhật nội dung')); }

  @Get('topics')
  topics() { return this.news.topics(true).then((data) => ok(data)); }

  @Post('topics')
  createTopic(@Body() dto: SaveNewsTopicDto) { return this.news.createTopic(dto).then((data) => ok(data, 'Đã tạo lĩnh vực')); }

  @Patch('topics/:id')
  updateTopic(@Param('id') id: string, @Body() dto: SaveNewsTopicDto) { return this.news.updateTopic(id, dto).then((data) => ok(data, 'Đã cập nhật lĩnh vực')); }

  @Get('experts')
  experts() { return this.news.experts(undefined, true).then((data) => ok(data)); }

  @Post('experts')
  createExpert(@Body() dto: SaveNewsExpertDto) { return this.news.createExpert(dto).then((data) => ok(data, 'Đã tạo chuyên gia')); }

  @Patch('experts/:id')
  updateExpert(@Param('id') id: string, @Body() dto: SaveNewsExpertDto) { return this.news.updateExpert(id, dto).then((data) => ok(data, 'Đã cập nhật chuyên gia')); }

  @Get('sources')
  sources() { return this.crawler.listSources().then((data) => ok(data)); }

  @Patch('sources/:id')
  updateSource(@Param('id') id: string, @Body() dto: UpdateNewsSourceDto) { return this.crawler.updateSource(id, dto).then((data) => ok(data, 'Đã cập nhật nguồn tin')); }

  @Post('sources/crawl-all')
  async crawlAll() {
    const sources = await this.crawler.listSources();
    const active = sources.filter((source) => source.isActive);
    await Promise.all(active.map((source) => this.crawlQueue.add(NEWS_CRAWL_SOURCE_JOB, { sourceId: source.id }, { jobId: `manual-${source.id}-${Date.now()}`, removeOnComplete: 50, removeOnFail: 100 })));
    return ok({ queued: active.length }, `Đã xếp lịch crawl ${active.length} nguồn`);
  }

  @Post('sources/:id/crawl')
  async crawlSource(@Param('id') id: string) {
    await this.crawler.updateSource(id, {});
    const job = await this.crawlQueue.add(NEWS_CRAWL_SOURCE_JOB, { sourceId: id }, { jobId: `manual-${id}-${Date.now()}`, removeOnComplete: 50, removeOnFail: 100 });
    return ok({ job_id: job.id, source_id: id }, 'Đã xếp lịch crawl nguồn tin');
  }
}
