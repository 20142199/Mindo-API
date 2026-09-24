import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ArticleStatus, NewsContentType, NewsCrawlStatus, NewsEditorialStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.module';
import { parseArticleHtml, parseListingHtml } from './html-news.parser';
import { NewsAiSummaryService } from './news-ai-summary.service';
import { sourceDefinition } from './news-source.definitions';
import { UpdateNewsSourceDto } from './news.dto';

const USER_AGENT = 'MindoNewsBot/1.0 (+https://mindo.vn/news-source)';
const MAX_HTML_BYTES = 3 * 1024 * 1024;

@Injectable()
export class NewsCrawlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiSummary: NewsAiSummaryService,
  ) {}

  listSources() {
    return this.prisma.newsSource.findMany({
      include: {
        topic: true,
        _count: { select: { articles: true, crawlRuns: true } },
        crawlRuns: { orderBy: { startedAt: 'desc' }, take: 5 },
      },
      orderBy: { name: 'asc' },
    });
  }

  async updateSource(id: string, dto: UpdateNewsSourceDto) {
    await this.assertSource(id);
    if (dto.topic_id && !(await this.prisma.newsTopic.count({ where: { id: dto.topic_id } }))) throw new NotFoundException('Lĩnh vực không tồn tại');
    return this.prisma.newsSource.update({
      where: { id },
      data: {
        isActive: dto.is_active,
        crawlIntervalMinutes: dto.crawl_interval_minutes,
        maxItemsPerRun: dto.max_items_per_run,
        topicId: dto.topic_id === '' ? null : dto.topic_id,
      },
      include: { topic: true, _count: { select: { articles: true, crawlRuns: true } }, crawlRuns: { orderBy: { startedAt: 'desc' }, take: 5 } },
    });
  }

  async crawlDueSources() {
    const sources = await this.prisma.newsSource.findMany({ where: { isActive: true } });
    const now = Date.now();
    const due = sources.filter((source) => !source.lastCrawledAt || now - source.lastCrawledAt.getTime() >= source.crawlIntervalMinutes * 60_000);
    const results = [];
    for (const source of due) results.push(await this.crawlSource(source.id));
    return results;
  }

  async crawlSource(id: string) {
    const source = await this.assertSource(id);
    const definition = sourceDefinition(source.key);
    if (!definition) throw new NotFoundException('Nguồn chưa có bộ đọc HTML');
    const run = await this.prisma.newsCrawlRun.create({ data: { sourceId: id } });

    try {
      const listingUrl = this.listingUrl(source.key, source.listingUrl);
      await this.assertRobotsAllowed(listingUrl);
      const listingHtml = await this.fetchHtml(listingUrl, definition.allowedHosts);
      const candidates = parseListingHtml(listingHtml, listingUrl, definition, Math.max(source.maxItemsPerRun * 4, 20));
      const keyed = candidates.map((candidate) => ({ ...candidate, externalKey: this.externalKey(candidate.url) }));
      const existing = keyed.length ? await this.prisma.newsArticle.findMany({
        where: { sourceId: id, externalKey: { in: keyed.map((row) => row.externalKey) } },
        select: { externalKey: true },
      }) : [];
      const existingKeys = new Set(existing.map((row) => row.externalKey));
      const fresh = keyed.filter((row) => !existingKeys.has(row.externalKey)).slice(0, source.maxItemsPerRun);
      let imported = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const candidate of fresh) {
        try {
          await this.assertRobotsAllowed(candidate.url);
          const html = await this.fetchHtml(candidate.url, definition.allowedHosts);
          const article = parseArticleHtml(html, candidate.url, definition);
          await this.prisma.newsArticle.create({
            data: {
              title: article.title,
              slug: this.articleSlug(article.title, candidate.externalKey),
              summary: article.summary,
              content: '',
              imageUrl: article.imageUrl,
              sourceUrl: article.url,
              sourceId: source.id,
              externalKey: candidate.externalKey,
              sourceTitle: article.title,
              sourceAuthor: article.author,
              sourceContent: article.content,
              sourcePublishedAt: article.publishedAt,
              sourceFetchedAt: new Date(),
              contentType: NewsContentType.ARTICLE,
              status: ArticleStatus.DRAFT,
              topicId: source.topicId,
            },
          });
          imported += 1;
        } catch (error) {
          failed += 1;
          errors.push(`${candidate.url}: ${this.errorMessage(error)}`);
        }
      }

      const skipped = candidates.length - fresh.length;
      const partialError = errors.slice(0, 3).join('\n') || null;
      const completedAt = new Date();
      await this.prisma.$transaction([
        this.prisma.newsCrawlRun.update({ where: { id: run.id }, data: { status: NewsCrawlStatus.SUCCESS, discovered: candidates.length, imported, skipped, failed, errorMessage: partialError, completedAt } }),
        this.prisma.newsSource.update({ where: { id }, data: { lastCrawledAt: completedAt, lastSuccessAt: completedAt, lastError: partialError } }),
      ]);
      return { run_id: run.id, source_id: id, discovered: candidates.length, imported, skipped, failed, errors: errors.slice(0, 3) };
    } catch (error) {
      const message = this.errorMessage(error);
      const completedAt = new Date();
      await this.prisma.$transaction([
        this.prisma.newsCrawlRun.update({ where: { id: run.id }, data: { status: NewsCrawlStatus.FAILED, failed: 1, errorMessage: message, completedAt } }),
        this.prisma.newsSource.update({ where: { id }, data: { lastCrawledAt: completedAt, lastError: message } }),
      ]);
      throw error;
    }
  }

  async prepareEditorial(id: string, force = false) {
    const article = await this.prisma.newsArticle.findUnique({
      where: { id },
      select: { id: true, sourceContent: true, aiEditorialStatus: true },
    });
    if (!article) throw new NotFoundException('Bài viết không tồn tại');
    if (!article.sourceContent?.trim()) throw new BadRequestException('Bài viết chưa có nội dung gốc để AI biên tập');
    if (!this.aiSummary.isConfigured()) throw new ServiceUnavailableException(this.aiSummary.configurationError());
    if (article.aiEditorialStatus === NewsEditorialStatus.PROCESSING) throw new ConflictException('Bài viết đang được AI xử lý');
    if (article.aiEditorialStatus === NewsEditorialStatus.READY && !force) {
      throw new BadRequestException('Bản tiếng Việt đã tồn tại; cần xác nhận biên tập lại');
    }
    const claimed = await this.prisma.newsArticle.updateMany({
      where: { id, aiEditorialStatus: { not: NewsEditorialStatus.PROCESSING } },
      data: { aiEditorialStatus: NewsEditorialStatus.PROCESSING, aiEditorialError: null },
    });
    if (!claimed.count) throw new ConflictException('Bài viết đang được AI xử lý');
    return { article_id: id, status: NewsEditorialStatus.PROCESSING };
  }

  async failEditorialQueue(id: string, error: unknown) {
    await this.prisma.newsArticle.updateMany({
      where: { id, aiEditorialStatus: NewsEditorialStatus.PROCESSING },
      data: { aiEditorialStatus: NewsEditorialStatus.FAILED, aiEditorialError: this.errorMessage(error) },
    });
  }

  async editorializeArticleById(id: string) {
    const article = await this.prisma.newsArticle.findUnique({
      where: { id },
      select: { id: true, sourceTitle: true, sourceContent: true, externalKey: true },
    });
    if (!article) throw new NotFoundException('Bài viết không tồn tại');
    if (!article.sourceContent?.trim()) throw new BadRequestException('Bài viết chưa có nội dung gốc để AI biên tập');
    try {
      const draft = await this.aiSummary.createEditorialDraft(article.sourceTitle ?? 'Bài viết nguồn', article.sourceContent);
      return await this.prisma.newsArticle.update({
        where: { id },
        data: {
          title: draft.title,
          slug: this.articleSlug(draft.title, article.externalKey ?? this.externalKey(article.id)),
          summary: draft.summary,
          aiSummary: draft.aiSummary,
          content: draft.content,
          aiEditorialStatus: NewsEditorialStatus.READY,
          aiEditorialError: null,
          aiEditorialModel: draft.model,
          aiEditorialInputTokens: draft.usage.inputTokens,
          aiEditorialOutputTokens: draft.usage.outputTokens,
          aiEditorialTotalTokens: draft.usage.totalTokens,
          aiEditorialAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.newsArticle.updateMany({
        where: { id },
        data: { aiEditorialStatus: NewsEditorialStatus.FAILED, aiEditorialError: this.errorMessage(error) },
      });
      throw error;
    }
  }

  private async assertSource(id: string) {
    const source = await this.prisma.newsSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('Nguồn tin không tồn tại');
    return source;
  }

  private externalKey(url: string) {
    return createHash('sha256').update(url).digest('hex');
  }

  private listingUrl(key: string, configuredUrl: string) {
    if (key === 'federal_reserve') return `https://www.federalreserve.gov/newsevents/pressreleases/${new Date().getUTCFullYear()}-press.htm`;
    if (key === 'yahoo_finance') return 'https://finance.yahoo.com/topic/stock-market-news/';
    if (key === 'world_bank') return 'https://www.worldbank.org/en/news';
    if (key === 'opec') return 'https://www.opec.org/';
    return configuredUrl;
  }

  private articleSlug(title: string, externalKey: string) {
    const value = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 90);
    return `${value || 'tin-tuc'}-${externalKey.slice(0, 10)}`;
  }

  private async fetchHtml(url: string, allowedHosts: string[]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        redirect: 'follow', signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml;q=0.9', 'accept-language': 'en-US,en;q=0.8' },
      });
      const finalUrl = new URL(response.url);
      if (!allowedHosts.includes(finalUrl.hostname.toLowerCase())) throw new Error('Nguồn chuyển hướng sang tên miền không được phép');
      if (!response.ok) throw new Error(`Website trả về HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get('content-length') ?? 0);
      if (declaredLength > MAX_HTML_BYTES) throw new Error('Trang HTML vượt quá giới hạn 3 MB');
      const html = await response.text();
      if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('Trang HTML vượt quá giới hạn 3 MB');
      return html;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async assertRobotsAllowed(urlValue: string) {
    const url = new URL(urlValue);
    const robotsUrl = `${url.origin}/robots.txt`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const response = await fetch(robotsUrl, { signal: controller.signal, headers: { 'user-agent': USER_AGENT, accept: 'text/plain' } }).finally(() => clearTimeout(timeout));
      if (!response.ok) return;
      const rules = this.robotsRules(await response.text());
      const path = `${url.pathname}${url.search}`;
      const matching = rules.filter((rule) => path.startsWith(rule.path)).sort((a, b) => b.path.length - a.path.length)[0];
      if (matching && !matching.allow) throw new Error('robots.txt không cho phép thu thập đường dẫn này');
    } catch (error) {
      if (this.errorMessage(error).includes('robots.txt')) throw error;
    }
  }

  private robotsRules(content: string) {
    const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
    let current: { agents: string[]; rules: Array<{ allow: boolean; path: string }> } | undefined;
    for (const original of content.split(/\r?\n/)) {
      const line = original.replace(/#.*$/, '').trim();
      if (!line) continue;
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      const field = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (field === 'user-agent') {
        if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
        current.agents.push(value.toLowerCase());
      } else if ((field === 'allow' || field === 'disallow') && current && value) current.rules.push({ allow: field === 'allow', path: value.replace(/\*.*$/, '') });
    }
    const specific = groups.filter((group) => group.agents.some((agent) => agent === 'mindonewsbot'));
    const selected = specific.length ? specific : groups.filter((group) => group.agents.includes('*'));
    return selected.flatMap((group) => group.rules).filter((rule) => rule.path);
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.name === 'AbortError' ? 'Website phản hồi quá thời gian cho phép' : error.message.slice(0, 1000);
    return 'Lỗi không xác định khi crawl nguồn tin';
  }
}
