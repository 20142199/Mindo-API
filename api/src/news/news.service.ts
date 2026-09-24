import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ArticleStatus, NewsContentType, NewsFeedbackType, Prisma } from '@prisma/client';
import { pageExtra } from '../common/api-response';
import { PrismaService } from '../common/prisma.module';
import { ListNewsDto, NewsFeedbackDto, SaveNewsArticleDto, SaveNewsExpertDto, SaveNewsTopicDto } from './news.dto';

const articleInclude = {
  topic: true,
  source: true,
  expert: { include: { _count: { select: { followers: true, articles: true } } } },
  _count: { select: { likes: true } },
} satisfies Prisma.NewsArticleInclude;

@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  async home(userId?: string) {
    const hidden = userId ? await this.hiddenFor(userId) : { articleIds: [], topicIds: [] };
    const [experts, articles, waves] = await Promise.all([
      this.prisma.newsExpert.findMany({
        where: { isActive: true },
        include: { _count: { select: { followers: true, articles: true } }, followers: userId ? { where: { userId }, select: { userId: true } } : false },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        take: 10,
      }),
      this.prisma.newsArticle.findMany({
        where: { status: ArticleStatus.PUBLISHED, contentType: NewsContentType.ARTICLE, id: { notIn: hidden.articleIds }, topicId: { notIn: hidden.topicIds } },
        include: articleInclude,
        orderBy: { publishedAt: 'desc' },
        take: 20,
      }),
      this.prisma.newsArticle.findMany({
        where: { status: ArticleStatus.PUBLISHED, contentType: NewsContentType.WAVE, id: { notIn: hidden.articleIds }, topicId: { notIn: hidden.topicIds } },
        include: articleInclude,
        orderBy: { publishedAt: 'desc' },
        take: 10,
      }),
    ]);
    const likes = userId ? await this.likedIds(userId, [...articles, ...waves].map((row) => row.id)) : new Set<string>();
    return {
      recommended_experts: experts.map((row) => this.expertView(row, Boolean('followers' in row && row.followers.length))),
      articles: articles.map((row) => this.articleView(row, likes.has(row.id))),
      waves: waves.map((row) => this.articleView(row, likes.has(row.id))),
    };
  }

  async listArticles(query: ListNewsDto, userId?: string, admin = false) {
    const skip = (query.page - 1) * query.limit;
    const hidden = !admin && userId ? await this.hiddenFor(userId) : { articleIds: [], topicIds: [] };
    const where: Prisma.NewsArticleWhereInput = {
      ...(admin ? {} : { status: ArticleStatus.PUBLISHED }),
      ...(query.q ? { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { summary: { contains: query.q, mode: 'insensitive' } }, { aiSummary: { contains: query.q, mode: 'insensitive' } }, { content: { contains: query.q, mode: 'insensitive' } }] } : {}),
      ...(query.topic ? { topic: { slug: query.topic } } : {}),
      ...(query.expert ? { expert: { slug: query.expert } } : {}),
      ...(query.type ? { contentType: query.type } : {}),
      ...(!admin ? { id: { notIn: hidden.articleIds }, topicId: { notIn: hidden.topicIds } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.newsArticle.findMany({ where, include: articleInclude, orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }], skip, take: query.limit }),
      this.prisma.newsArticle.count({ where }),
    ]);
    const likes = userId ? await this.likedIds(userId, rows.map((row) => row.id)) : new Set<string>();
    return { data: rows.map((row) => this.articleView(row, likes.has(row.id), admin)), extra: pageExtra(query.page, query.limit, total) };
  }

  async article(idOrSlug: string, userId?: string) {
    const row = await this.prisma.newsArticle.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }], status: ArticleStatus.PUBLISHED },
      include: articleInclude,
    });
    if (!row) throw new NotFoundException('Bài viết không tồn tại');
    const liked = userId ? (await this.prisma.newsArticleLike.count({ where: { userId, articleId: row.id } })) > 0 : false;
    return this.articleView(row, liked);
  }

  async search(keyword: string, limit: number, userId?: string) {
    const query = keyword.trim();
    const [articles, experts] = await Promise.all([
      this.prisma.newsArticle.findMany({
        where: { status: ArticleStatus.PUBLISHED, OR: [{ title: { contains: query, mode: 'insensitive' } }, { summary: { contains: query, mode: 'insensitive' } }, { aiSummary: { contains: query, mode: 'insensitive' } }, { topic: { name: { contains: query, mode: 'insensitive' } } }] },
        include: articleInclude,
        orderBy: { publishedAt: 'desc' },
        take: limit,
      }),
      this.prisma.newsExpert.findMany({
        where: { isActive: true, OR: [{ name: { contains: query, mode: 'insensitive' } }, { specialty: { contains: query, mode: 'insensitive' } }] },
        include: { _count: { select: { followers: true, articles: true } }, followers: userId ? { where: { userId }, select: { userId: true } } : false },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        take: limit,
      }),
    ]);
    const likes = userId ? await this.likedIds(userId, articles.map((row) => row.id)) : new Set<string>();
    return {
      total: articles.length + experts.length,
      articles: articles.map((row) => this.articleView(row, likes.has(row.id))),
      experts: experts.map((row) => this.expertView(row, Boolean('followers' in row && row.followers.length))),
    };
  }

  topics(admin = false) {
    return this.prisma.newsTopic.findMany({ where: admin ? {} : { isActive: true }, include: { _count: { select: { articles: true, interests: true } } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  async experts(userId?: string, admin = false) {
    const rows = await this.prisma.newsExpert.findMany({
      where: admin ? {} : { isActive: true },
      include: { _count: { select: { followers: true, articles: true } }, followers: userId ? { where: { userId }, select: { userId: true } } : false },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.expertView(row, Boolean('followers' in row && row.followers.length)));
  }

  async expert(idOrSlug: string, userId?: string) {
    const row = await this.prisma.newsExpert.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }], isActive: true },
      include: { _count: { select: { followers: true, articles: true } }, followers: userId ? { where: { userId }, select: { userId: true } } : false, articles: { where: { status: ArticleStatus.PUBLISHED }, include: articleInclude, orderBy: { publishedAt: 'desc' }, take: 20 } },
    });
    if (!row) throw new NotFoundException('Chuyên gia không tồn tại');
    return { ...this.expertView(row, Boolean('followers' in row && row.followers.length)), articles: row.articles.map((article) => this.articleView(article, false)) };
  }

  async follow(userId: string, expertId: string) {
    await this.assertExpert(expertId);
    await this.prisma.newsExpertFollow.upsert({ where: { userId_expertId: { userId, expertId } }, create: { userId, expertId }, update: {} });
    return { expert_id: expertId, is_following: true };
  }

  async unfollow(userId: string, expertId: string) {
    await this.prisma.newsExpertFollow.deleteMany({ where: { userId, expertId } });
    return { expert_id: expertId, is_following: false };
  }

  async profile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, fullName: true, nickname: true, avatarFileId: true } });
    const [interests, experts] = await Promise.all([
      this.prisma.newsUserInterest.findMany({ where: { userId }, include: { topic: true }, orderBy: { topic: { sortOrder: 'asc' } } }),
      this.prisma.newsExpertFollow.findMany({ where: { userId }, include: { expert: { include: { _count: { select: { followers: true, articles: true } } } } }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { user: { id: user.id, full_name: user.nickname ?? user.fullName, avatar_url: user.avatarFileId }, interests: interests.map((row) => row.topic), followed_experts: experts.map((row) => this.expertView(row.expert, true)) };
  }

  async setInterests(userId: string, topicIds: string[]) {
    const unique = [...new Set(topicIds)];
    const count = await this.prisma.newsTopic.count({ where: { id: { in: unique }, isActive: true } });
    if (count !== unique.length) throw new BadRequestException('Có lĩnh vực không tồn tại hoặc đã bị tắt');
    await this.prisma.$transaction(async (tx) => {
      await tx.newsUserInterest.deleteMany({ where: { userId } });
      if (unique.length) await tx.newsUserInterest.createMany({ data: unique.map((topicId) => ({ userId, topicId })) });
    });
    return this.profile(userId);
  }

  async like(userId: string, articleId: string) {
    await this.assertArticle(articleId);
    await this.prisma.newsArticleLike.upsert({ where: { userId_articleId: { userId, articleId } }, create: { userId, articleId }, update: {} });
    return this.likeResult(userId, articleId);
  }

  async unlike(userId: string, articleId: string) {
    await this.prisma.newsArticleLike.deleteMany({ where: { userId, articleId } });
    return this.likeResult(userId, articleId);
  }

  async feedback(userId: string, articleId: string, dto: NewsFeedbackDto) {
    const article = await this.assertArticle(articleId);
    if (dto.type === NewsFeedbackType.REPORT && !dto.reason?.trim()) throw new BadRequestException('Vui lòng nhập lý do tố cáo');
    await this.prisma.newsArticleFeedback.upsert({
      where: { userId_articleId_type: { userId, articleId, type: dto.type } },
      create: { userId, articleId, type: dto.type, reason: dto.reason?.trim(), topicId: dto.type === NewsFeedbackType.HIDE_TOPIC ? article.topicId : undefined },
      update: { reason: dto.reason?.trim(), topicId: dto.type === NewsFeedbackType.HIDE_TOPIC ? article.topicId : undefined },
    });
    return { article_id: articleId, type: dto.type, received: true };
  }

  createArticle(dto: SaveNewsArticleDto) { return this.saveArticle(undefined, dto); }
  updateArticle(id: string, dto: SaveNewsArticleDto) { return this.saveArticle(id, dto); }

  async saveArticle(id: string | undefined, dto: SaveNewsArticleDto) {
    if (dto.topic_id && !(await this.prisma.newsTopic.count({ where: { id: dto.topic_id } }))) throw new BadRequestException('Lĩnh vực không tồn tại');
    if (dto.expert_id && !(await this.prisma.newsExpert.count({ where: { id: dto.expert_id } }))) throw new BadRequestException('Chuyên gia không tồn tại');
    if (dto.content_type === NewsContentType.WAVE && !dto.video_url) throw new BadRequestException('Nội dung Sóng cần có video');
    const current = id ? await this.prisma.newsArticle.findUnique({ where: { id } }) : undefined;
    if (id && !current) throw new NotFoundException('Bài viết không tồn tại');
    const status = dto.status ?? current?.status ?? ArticleStatus.DRAFT;
    const data = {
      title: dto.title.trim(), slug: dto.slug.trim().toLowerCase(), summary: dto.summary.trim(), content: dto.content.trim(),
      imageUrl: dto.image_url, videoUrl: dto.video_url, sourceUrl: dto.source_url, contentType: dto.content_type ?? current?.contentType ?? NewsContentType.ARTICLE,
      status, topicId: dto.topic_id || null, expertId: dto.expert_id || null,
      publishedAt: status === ArticleStatus.PUBLISHED ? current?.publishedAt ?? new Date() : null,
    };
    const row = id ? await this.prisma.newsArticle.update({ where: { id }, data, include: articleInclude }) : await this.prisma.newsArticle.create({ data, include: articleInclude });
    return this.articleView(row, false);
  }

  createTopic(dto: SaveNewsTopicDto) { return this.prisma.newsTopic.create({ data: { name: dto.name.trim(), slug: dto.slug.trim().toLowerCase(), isActive: dto.is_active, sortOrder: dto.sort_order } }); }
  updateTopic(id: string, dto: SaveNewsTopicDto) { return this.prisma.newsTopic.update({ where: { id }, data: { name: dto.name.trim(), slug: dto.slug.trim().toLowerCase(), isActive: dto.is_active, sortOrder: dto.sort_order } }); }

  createExpert(dto: SaveNewsExpertDto) { return this.prisma.newsExpert.create({ data: this.expertData(dto) }); }
  updateExpert(id: string, dto: SaveNewsExpertDto) { return this.prisma.newsExpert.update({ where: { id }, data: this.expertData(dto) }); }

  private expertData(dto: SaveNewsExpertDto) {
    const initials = dto.initials?.trim().toUpperCase() || dto.name.trim().split(/\s+/).slice(-2).map((part) => part[0]).join('').toUpperCase();
    return { name: dto.name.trim(), slug: dto.slug.trim().toLowerCase(), specialty: dto.specialty.trim(), bio: dto.bio.trim(), avatarUrl: dto.avatar_url, coverUrl: dto.cover_url, initials, isVerified: dto.is_verified, isActive: dto.is_active, sortOrder: dto.sort_order };
  }

  private articleView(row: Prisma.NewsArticleGetPayload<{ include: typeof articleInclude }>, isLiked: boolean, admin = false) {
    return {
      id: row.id, title: row.title, slug: row.slug, summary: row.summary, ai_summary: row.aiSummary, content: row.content,
      image_url: row.imageUrl, video_url: row.videoUrl, source_url: row.sourceUrl, content_type: row.contentType,
      status: row.status, published_at: row.publishedAt, created_at: row.createdAt, updated_at: row.updatedAt,
      topic: row.topic, expert: row.expert ? this.expertView(row.expert, false) : null,
      like_count: row._count.likes, is_liked: isLiked,
      ...(admin ? {
        source: row.source ? { id: row.source.id, key: row.source.key, name: row.source.name, base_url: row.source.baseUrl } : null,
        source_author: row.sourceAuthor,
        source_content: row.sourceContent,
        source_published_at: row.sourcePublishedAt,
        source_fetched_at: row.sourceFetchedAt,
      } : {}),
    };
  }

  private expertView(row: { id: string; name: string; slug: string; specialty: string; bio: string; avatarUrl: string | null; coverUrl: string | null; initials: string; isVerified: boolean; isActive: boolean; sortOrder: number; _count: { followers: number; articles: number } }, following: boolean) {
    return { id: row.id, name: row.name, slug: row.slug, specialty: row.specialty, bio: row.bio, avatar_url: row.avatarUrl, cover_url: row.coverUrl, initials: row.initials, is_verified: row.isVerified, is_active: row.isActive, sort_order: row.sortOrder, follower_count: row._count.followers, article_count: row._count.articles, is_following: following };
  }

  private async hiddenFor(userId: string) {
    const rows = await this.prisma.newsArticleFeedback.findMany({ where: { userId, type: { in: [NewsFeedbackType.NOT_INTERESTED, NewsFeedbackType.HIDE_TOPIC] } }, select: { articleId: true, topicId: true, type: true } });
    return { articleIds: rows.filter((row) => row.type === NewsFeedbackType.NOT_INTERESTED).map((row) => row.articleId), topicIds: rows.filter((row) => row.type === NewsFeedbackType.HIDE_TOPIC && row.topicId).map((row) => row.topicId!) };
  }

  private async likedIds(userId: string, articleIds: string[]) {
    if (!articleIds.length) return new Set<string>();
    const rows = await this.prisma.newsArticleLike.findMany({ where: { userId, articleId: { in: articleIds } }, select: { articleId: true } });
    return new Set(rows.map((row) => row.articleId));
  }

  private async assertExpert(id: string) {
    const row = await this.prisma.newsExpert.findFirst({ where: { id, isActive: true } });
    if (!row) throw new NotFoundException('Chuyên gia không tồn tại');
    return row;
  }

  private async assertArticle(id: string) {
    const row = await this.prisma.newsArticle.findFirst({ where: { id, status: ArticleStatus.PUBLISHED } });
    if (!row) throw new NotFoundException('Bài viết không tồn tại');
    return row;
  }

  private async likeResult(userId: string, articleId: string) {
    const [likeCount, own] = await Promise.all([this.prisma.newsArticleLike.count({ where: { articleId } }), this.prisma.newsArticleLike.count({ where: { articleId, userId } })]);
    return { article_id: articleId, like_count: likeCount, is_liked: own > 0 };
  }
}
