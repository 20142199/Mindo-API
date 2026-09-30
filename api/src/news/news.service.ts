import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ArticleStatus, NewsContentType, NewsFeedbackType, Prisma } from '@prisma/client';
import { pageExtra } from '../common/api-response';
import { PrismaService } from '../common/prisma.module';
import { ListNewsDto, NewsFeedbackDto, SaveNewsArticleDto, SaveNewsExpertDto, SaveNewsTopicDto } from './news.dto';
import { sourceClassification } from './news-source.definitions';

const articleInclude = {
  topic: true,
  source: true,
  expert: { include: { _count: { select: { followers: true, articles: true } } } },
  _count: { select: { likes: true } },
} satisfies Prisma.NewsArticleInclude;

/** Những gì một người đã ẩn khỏi bảng tin của mình — xem `hiddenFor`. */
type HiddenNews = { articleIds: string[]; topicIds: string[]; sourceIds: string[] };

const NOTHING_HIDDEN: HiddenNews = { articleIds: [], topicIds: [], sourceIds: [] };

/** Việt Nam không áp dụng DST, nên lệch UTC+7 cố định quanh năm. */
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1_000;

/** Phần của Prisma mà việc đếm hạn mức cần — dùng được cả trong transaction. */
type UsageClient = Pick<Prisma.TransactionClient, 'newsAiSummaryUnlock' | 'nftAsset'>;

@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  async home(userId?: string) {
    const visible = this.visibleFilters(userId ? await this.hiddenFor(userId) : NOTHING_HIDDEN);
    const [experts, articles, waves] = await Promise.all([
      this.prisma.newsExpert.findMany({
        where: { isActive: true },
        include: { _count: { select: { followers: true, articles: true } }, followers: userId ? { where: { userId }, select: { userId: true } } : false },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        take: 10,
      }),
      this.prisma.newsArticle.findMany({
        where: { deletedAt: null, status: ArticleStatus.PUBLISHED, contentType: NewsContentType.ARTICLE, AND: visible },
        include: articleInclude,
        orderBy: { publishedAt: 'desc' },
        take: 20,
      }),
      this.prisma.newsArticle.findMany({
        where: { deletedAt: null, status: ArticleStatus.PUBLISHED, contentType: NewsContentType.WAVE, AND: visible },
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
    const forYou = !admin && query.feed === 'for_you' ? await this.interestTopicIds(userId) : undefined;
    /*
      Chưa chọn lĩnh vực nào thì "Dành cho bạn" rỗng theo định nghĩa. Trả luôn,
      đừng để `topicId: { in: [] }` đi xuống DB chỉ để nhận về con số 0.
    */
    if (forYou && !forYou.length) return { data: [], extra: pageExtra(query.page, query.limit, 0) };
    const hidden = !admin && userId ? await this.hiddenFor(userId) : NOTHING_HIDDEN;
    const where: Prisma.NewsArticleWhereInput = {
      deletedAt: null,
      ...(admin ? {} : { status: ArticleStatus.PUBLISHED }),
      ...(query.q ? { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { summary: { contains: query.q, mode: 'insensitive' } }, { aiSummary: { contains: query.q, mode: 'insensitive' } }, { content: { contains: query.q, mode: 'insensitive' } }] } : {}),
      ...(query.topic ? { topic: { slug: query.topic } } : {}),
      ...(query.expert ? { expert: { slug: query.expert } } : {}),
      ...(query.type ? { contentType: query.type } : {}),
      ...(forYou ? { topicId: { in: forYou } } : {}),
      AND: this.visibleFilters(hidden),
    };
    const [rows, total] = await Promise.all([
      this.prisma.newsArticle.findMany({ where, include: articleInclude, orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }], skip, take: query.limit }),
      this.prisma.newsArticle.count({ where }),
    ]);
    const likes = userId ? await this.likedIds(userId, rows.map((row) => row.id)) : new Set<string>();
    return { data: rows.map((row) => this.articleView(row, likes.has(row.id), { admin })), extra: pageExtra(query.page, query.limit, total) };
  }

  async article(idOrSlug: string, userId?: string) {
    const row = await this.prisma.newsArticle.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }], status: ArticleStatus.PUBLISHED, deletedAt: null },
      include: articleInclude,
    });
    if (!row) throw new NotFoundException('Bài viết không tồn tại');
    const [likes, unlocks] = userId
      ? await Promise.all([
        this.prisma.newsArticleLike.count({ where: { userId, articleId: row.id } }),
        this.prisma.newsAiSummaryUnlock.count({ where: { userId, articleId: row.id } }),
      ])
      : [0, 0];
    const unlocked = unlocks > 0;
    return { ...this.articleView(row, likes > 0, { revealAiSummary: unlocked }), ai_summary_unlocked: unlocked };
  }

  async search(keyword: string, limit: number, userId?: string) {
    const query = keyword.trim();
    const [articles, experts] = await Promise.all([
      this.prisma.newsArticle.findMany({
        where: { status: ArticleStatus.PUBLISHED, deletedAt: null, OR: [{ title: { contains: query, mode: 'insensitive' } }, { summary: { contains: query, mode: 'insensitive' } }, { aiSummary: { contains: query, mode: 'insensitive' } }, { topic: { name: { contains: query, mode: 'insensitive' } } }] },
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
      include: { _count: { select: { followers: true, articles: true } }, followers: userId ? { where: { userId }, select: { userId: true } } : false, articles: { where: { status: ArticleStatus.PUBLISHED, deletedAt: null }, include: articleInclude, orderBy: { publishedAt: 'desc' }, take: 20 } },
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
    const [interests, experts, hidden] = await Promise.all([
      this.prisma.newsUserInterest.findMany({ where: { userId }, include: { topic: true }, orderBy: { topic: { sortOrder: 'asc' } } }),
      this.prisma.newsExpertFollow.findMany({ where: { userId }, include: { expert: { include: { _count: { select: { followers: true, articles: true } } } } }, orderBy: { createdAt: 'desc' } }),
      this.hiddenFor(userId),
    ]);
    return {
      user: { id: user.id, full_name: user.nickname ?? user.fullName, avatar_url: user.avatarFileId },
      interests: interests.map((row) => row.topic),
      followed_experts: experts.map((row) => this.expertView(row.expert, true)),
      /* App bỏ chip của các lĩnh vực này ở tab "Tất cả" — bấm vào chỉ ra danh sách rỗng. */
      hidden_topic_ids: hidden.topicIds,
    };
  }

  async setInterests(userId: string, topicIds: string[]) {
    const unique = [...new Set(topicIds)];
    const count = await this.prisma.newsTopic.count({ where: { id: { in: unique }, isActive: true } });
    if (count !== unique.length) throw new BadRequestException('Có lĩnh vực không tồn tại hoặc đã bị tắt');
    await this.prisma.$transaction(async (tx) => {
      await tx.newsUserInterest.deleteMany({ where: { userId } });
      if (unique.length) await tx.newsUserInterest.createMany({ data: unique.map((topicId) => ({ userId, topicId })) });
      /*
        Chọn lại một lĩnh vực từng bị ẩn nghĩa là muốn thấy nó trở lại. Không gỡ
        ẩn thì lĩnh vực đó vừa "quan tâm" vừa "bị ẩn", và tab "Dành cho bạn" im
        lặng không có bài nào của nó. Màn Chọn lĩnh vực vì vậy cũng là chỗ hoàn
        tác việc ẩn lĩnh vực — thiết kế không có chỗ nào khác.
      */
      if (unique.length) await tx.newsArticleFeedback.deleteMany({ where: { userId, type: NewsFeedbackType.HIDE_TOPIC, topicId: { in: unique } } });
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
    if (dto.type === NewsFeedbackType.HIDE_TOPIC && !article.topicId) throw new BadRequestException('Bài viết chưa thuộc lĩnh vực nào');
    if (dto.type === NewsFeedbackType.HIDE_SOURCE && !article.sourceId) throw new BadRequestException('Bài viết không có nguồn để ẩn');
    /* Chép lĩnh vực / nguồn từ bài vào phản hồi để `hiddenFor` đọc thẳng, không join. */
    const scope = {
      topicId: dto.type === NewsFeedbackType.HIDE_TOPIC ? article.topicId : undefined,
      sourceId: dto.type === NewsFeedbackType.HIDE_SOURCE ? article.sourceId : undefined,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.newsArticleFeedback.upsert({
        where: { userId_articleId_type: { userId, articleId, type: dto.type } },
        create: { userId, articleId, type: dto.type, reason: dto.reason?.trim(), ...scope },
        update: { reason: dto.reason?.trim(), ...scope },
      });
      /* Ngược với `setInterests`: đã ẩn thì không còn là lĩnh vực quan tâm. */
      if (dto.type === NewsFeedbackType.HIDE_TOPIC) await tx.newsUserInterest.deleteMany({ where: { userId, topicId: article.topicId! } });
    });
    return { article_id: articleId, type: dto.type, received: true };
  }

  /**
   * Hạn mức mở bản tóm tắt AI của tin tức — TÁCH RIÊNG khỏi quota chat AI
   * (`AiService.usage`) nhưng cùng khuôn và cùng dạng dữ liệu trả về, để app
   * hiển thị hai thứ bằng một kiểu.
   *
   * Tính theo THÁNG DƯƠNG LỊCH ở giờ Việt Nam, vì thiết kế ghi "còn 8/10 lượt
   * tháng này". Mỗi Peer (NFT) đang sở hữu cộng thêm một số lượt — đó là thứ
   * nút "Mua thêm Peer để tăng hạn mức" hứa hẹn.
   */
  async aiSummaryUsage(userId: string, db: UsageClient = this.prisma) {
    const window = NewsService.monthWindow();
    const [used, peerOwned] = await Promise.all([
      db.newsAiSummaryUnlock.count({ where: { userId, createdAt: { gte: window.start } } }),
      db.nftAsset.count({ where: { ownerId: userId } }),
    ]);
    const baseLimit = NewsService.positiveInteger(process.env.NEWS_AI_SUMMARY_MONTHLY_LIMIT, 10);
    const perPeer = NewsService.positiveInteger(process.env.NEWS_AI_SUMMARY_LIMIT_PER_PEER, 5, true);
    const peerBonusLimit = peerOwned * perPeer;
    const limit = baseLimit + peerBonusLimit;
    return {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      can_use: used < limit,
      period: 'monthly',
      timezone: 'Asia/Ho_Chi_Minh',
      reset_at: window.resetAt.toISOString(),
      base_limit: baseLimit,
      peer_owned: peerOwned,
      peer_bonus_per_item: perPeer,
      peer_bonus_limit: peerBonusLimit,
    };
  }

  /**
   * Mở bản tóm tắt AI của một bài cho một người. Bản tóm tắt có sẵn từ lúc AI
   * biên tập bài, nên ở đây KHÔNG gọi LLM — chỉ ghi nhận một lượt.
   *
   * Mỗi bài chỉ trừ một lần: mở lại bài đã mở thì trả `charged: false` và
   * không đụng tới hạn mức, kể cả khi đã hết lượt.
   *
   * Đếm-rồi-ghi nằm trong một transaction có khoá advisory theo người dùng:
   * không khoá thì hai lần bấm cùng lúc ở lượt cuối đều đếm thấy "còn 1" và cả
   * hai cùng được ghi, vượt hạn mức.
   */
  async unlockAiSummary(userId: string, articleId: string) {
    const article = await this.assertArticle(articleId);
    if (!article.aiSummary?.trim()) throw new BadRequestException('Bài viết chưa có bản tóm tắt AI');
    const outcome = await this.prisma.$transaction(async (tx) => {
      /* `$executeRaw` chứ không phải `$queryRaw`: hàm này trả `void`, và Prisma không đọc được cột kiểu void. */
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const existing = await tx.newsAiSummaryUnlock.findUnique({ where: { userId_articleId: { userId, articleId } } });
      if (existing) return { charged: false, usage: await this.aiSummaryUsage(userId, tx) };
      const usage = await this.aiSummaryUsage(userId, tx);
      /* Có `code` để app mở trạng thái "hết lượt" thay vì toast lỗi — cùng cách với `AI_DAILY_LIMIT_REACHED`. */
      if (!usage.can_use) {
        throw new BadRequestException({
          message: `Bạn đã dùng hết ${usage.limit} lượt tóm tắt AI của tháng này`,
          code: 'NEWS_AI_SUMMARY_LIMIT_REACHED',
          used: usage.used,
          limit: usage.limit,
          peer_owned: usage.peer_owned,
          reset_at: usage.reset_at,
        });
      }
      await tx.newsAiSummaryUnlock.create({ data: { userId, articleId } });
      return { charged: true, usage: await this.aiSummaryUsage(userId, tx) };
    });
    return { article_id: articleId, ai_summary: article.aiSummary, ...outcome };
  }

  createArticle(dto: SaveNewsArticleDto) { return this.saveArticle(undefined, dto); }
  updateArticle(id: string, dto: SaveNewsArticleDto) { return this.saveArticle(id, dto); }

  async adminArticle(id: string) {
    const row = await this.prisma.newsArticle.findFirst({
      where: { id, deletedAt: null },
      include: articleInclude,
    });
    if (!row) throw new NotFoundException('Bài viết không tồn tại');
    return this.articleView(row, false, { admin: true });
  }

  async archiveArticle(actorId: string, id: string) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.newsArticle.findFirst({ where: { id, deletedAt: null }, select: { id: true, title: true, status: true } });
      if (!current) throw new NotFoundException('Bài viết không tồn tại');
      const archived = await tx.newsArticle.update({
        where: { id },
        data: { status: ArticleStatus.HIDDEN, publishedAt: null, deletedAt: new Date() },
        include: articleInclude,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'NEWS_ARTICLE_ARCHIVED',
          entityType: 'NewsArticle',
          entityId: id,
          metadata: { title: current.title, previous_status: current.status },
        },
      });
      return archived;
    });
    return this.articleView(row, false, { admin: true });
  }

  async saveArticle(id: string | undefined, dto: SaveNewsArticleDto) {
    if (dto.topic_id && !(await this.prisma.newsTopic.count({ where: { id: dto.topic_id } }))) throw new BadRequestException('Lĩnh vực không tồn tại');
    if (dto.expert_id && !(await this.prisma.newsExpert.count({ where: { id: dto.expert_id } }))) throw new BadRequestException('Chuyên gia không tồn tại');
    if (dto.content_type === NewsContentType.WAVE && !dto.video_url) throw new BadRequestException('Nội dung Sóng cần có video');
    const current = id ? await this.prisma.newsArticle.findFirst({ where: { id, deletedAt: null } }) : undefined;
    if (id && !current) throw new NotFoundException('Bài viết không tồn tại');
    const status = dto.status ?? current?.status ?? ArticleStatus.DRAFT;
    const data = {
      title: dto.title.trim(), slug: dto.slug.trim().toLowerCase(), summary: dto.summary.trim(), content: dto.content.trim(),
      imageUrl: dto.image_url, videoUrl: dto.video_url, sourceUrl: dto.source_url, contentType: dto.content_type ?? current?.contentType ?? NewsContentType.ARTICLE,
      status, topicId: dto.topic_id || null, expertId: dto.expert_id || null,
      publishedAt: status === ArticleStatus.PUBLISHED ? current?.publishedAt ?? new Date() : null,
    };
    const row = id ? await this.prisma.newsArticle.update({ where: { id }, data, include: articleInclude }) : await this.prisma.newsArticle.create({ data, include: articleInclude });
    /* Chỉ endpoint admin gọi tới đây, nên trả bản admin — có tóm tắt AI và nguồn gốc. */
    return this.articleView(row, false, { admin: true });
  }

  createTopic(dto: SaveNewsTopicDto) { return this.prisma.newsTopic.create({ data: { name: dto.name.trim(), slug: dto.slug.trim().toLowerCase(), isActive: dto.is_active, sortOrder: dto.sort_order } }); }
  updateTopic(id: string, dto: SaveNewsTopicDto) { return this.prisma.newsTopic.update({ where: { id }, data: { name: dto.name.trim(), slug: dto.slug.trim().toLowerCase(), isActive: dto.is_active, sortOrder: dto.sort_order } }); }

  createExpert(dto: SaveNewsExpertDto) { return this.prisma.newsExpert.create({ data: this.expertData(dto) }); }
  updateExpert(id: string, dto: SaveNewsExpertDto) { return this.prisma.newsExpert.update({ where: { id }, data: this.expertData(dto) }); }

  private expertData(dto: SaveNewsExpertDto) {
    const initials = dto.initials?.trim().toUpperCase() || dto.name.trim().split(/\s+/).slice(-2).map((part) => part[0]).join('').toUpperCase();
    return { name: dto.name.trim(), slug: dto.slug.trim().toLowerCase(), specialty: dto.specialty.trim(), bio: dto.bio.trim(), avatarUrl: dto.avatar_url, coverUrl: dto.cover_url, initials, isVerified: dto.is_verified, isActive: dto.is_active, sortOrder: dto.sort_order };
  }

  /**
   * `ai_summary` chỉ ra ngoài ở trang admin, hoặc ở chi tiết bài khi người
   * đọc đã mở khoá bài đó (`revealAiSummary`). Trả cho mọi người thì hạn mức
   * "còn 8/10 lượt" chỉ để trưng: app đã cầm sẵn bản tóm tắt trong tay.
   * `has_ai_summary` cho app biết có nên vẽ thẻ AI hay không.
   */
  private articleView(
    row: Prisma.NewsArticleGetPayload<{ include: typeof articleInclude }>,
    isLiked: boolean,
    { admin = false, revealAiSummary = false }: { admin?: boolean; revealAiSummary?: boolean } = {},
  ) {
    return {
      id: row.id, title: row.title, slug: row.slug, summary: row.summary,
      ai_summary: admin || revealAiSummary ? row.aiSummary : null,
      has_ai_summary: Boolean(row.aiSummary?.trim()),
      content: row.content,
      image_url: row.imageUrl, video_url: row.videoUrl, source_url: row.sourceUrl, content_type: row.contentType,
      status: row.status, published_at: row.publishedAt, created_at: row.createdAt, updated_at: row.updatedAt,
      topic: row.topic, expert: row.expert ? this.expertView(row.expert, false) : null,
      /* Tên nguồn là dòng "CafeF · 2 giờ" ở thẻ bài. `key` và `base_url` là chuyện nội bộ của crawler. */
      source: row.source ? { id: row.source.id, name: row.source.name, ...sourceClassification(row.source.key), ...(admin ? { key: row.source.key, base_url: row.source.baseUrl } : {}) } : null,
      like_count: row._count.likes, is_liked: isLiked,
      ...(admin ? {
        source_title: row.sourceTitle,
        source_author: row.sourceAuthor,
        source_content: row.sourceContent,
        source_published_at: row.sourcePublishedAt,
        source_fetched_at: row.sourceFetchedAt,
        ai_editorial_status: row.aiEditorialStatus,
        ai_editorial_error: row.aiEditorialError,
        ai_editorial_model: row.aiEditorialModel,
        ai_editorial_input_tokens: row.aiEditorialInputTokens,
        ai_editorial_output_tokens: row.aiEditorialOutputTokens,
        ai_editorial_total_tokens: row.aiEditorialTotalTokens,
        ai_editorial_at: row.aiEditorialAt,
      } : {}),
    };
  }

  private expertView(row: { id: string; name: string; slug: string; specialty: string; bio: string; avatarUrl: string | null; coverUrl: string | null; initials: string; isVerified: boolean; isActive: boolean; sortOrder: number; _count: { followers: number; articles: number } }, following: boolean) {
    return { id: row.id, name: row.name, slug: row.slug, specialty: row.specialty, bio: row.bio, avatar_url: row.avatarUrl, cover_url: row.coverUrl, initials: row.initials, is_verified: row.isVerified, is_active: row.isActive, sort_order: row.sortOrder, follower_count: row._count.followers, article_count: row._count.articles, is_following: following };
  }

  private async hiddenFor(userId: string): Promise<HiddenNews> {
    const rows = await this.prisma.newsArticleFeedback.findMany({
      where: { userId, type: { in: [NewsFeedbackType.NOT_INTERESTED, NewsFeedbackType.HIDE_TOPIC, NewsFeedbackType.HIDE_SOURCE] } },
      select: { articleId: true, topicId: true, sourceId: true, type: true },
    });
    const pick = (type: NewsFeedbackType, value: (row: (typeof rows)[number]) => string | null) =>
      [...new Set(rows.filter((row) => row.type === type).map(value).filter((id): id is string => Boolean(id)))];
    return {
      articleIds: pick(NewsFeedbackType.NOT_INTERESTED, (row) => row.articleId),
      topicIds: pick(NewsFeedbackType.HIDE_TOPIC, (row) => row.topicId),
      sourceIds: pick(NewsFeedbackType.HIDE_SOURCE, (row) => row.sourceId),
    };
  }

  /**
   * Điều kiện bỏ bài người dùng đã ẩn, để đặt vào `AND` của truy vấn bài.
   *
   * `topicId` và `sourceId` được phép NULL, và `NOT IN` của SQL coi
   * `NULL NOT IN (...)` là NULL — tức là LOẠI dòng đó. Viết trần
   * `topicId: { notIn }` thì ẩn một lĩnh vực bất kỳ là mọi bài chưa có lĩnh
   * vực biến mất theo (trên DB local: 218 bài còn 0). Nên phải mở đường cho
   * NULL một cách tường minh.
   */
  private visibleFilters(hidden: HiddenNews): Prisma.NewsArticleWhereInput[] {
    return [
      ...(hidden.articleIds.length ? [{ id: { notIn: hidden.articleIds } }] : []),
      ...(hidden.topicIds.length ? [{ OR: [{ topicId: null }, { topicId: { notIn: hidden.topicIds } }] }] : []),
      ...(hidden.sourceIds.length ? [{ OR: [{ sourceId: null }, { sourceId: { notIn: hidden.sourceIds } }] }] : []),
    ];
  }

  private async interestTopicIds(userId?: string) {
    if (!userId) throw new UnauthorizedException('Cần đăng nhập để xem tin dành cho bạn');
    const rows = await this.prisma.newsUserInterest.findMany({ where: { userId }, select: { topicId: true } });
    return rows.map((row) => row.topicId);
  }

  /** Từ 00:00 ngày 1 tháng này tới 00:00 ngày 1 tháng sau, theo giờ Việt Nam. */
  private static monthWindow(now = Date.now()) {
    const local = new Date(now + VIETNAM_OFFSET_MS);
    const year = local.getUTCFullYear();
    const month = local.getUTCMonth();
    return {
      start: new Date(Date.UTC(year, month, 1) - VIETNAM_OFFSET_MS),
      resetAt: new Date(Date.UTC(year, month + 1, 1) - VIETNAM_OFFSET_MS),
    };
  }

  private static positiveInteger(value: string | undefined, fallback: number, allowZero = false) {
    const parsed = Number(value ?? fallback);
    return Number.isInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0) ? parsed : fallback;
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
    const row = await this.prisma.newsArticle.findFirst({ where: { id, status: ArticleStatus.PUBLISHED, deletedAt: null } });
    if (!row) throw new NotFoundException('Bài viết không tồn tại');
    return row;
  }

  private async likeResult(userId: string, articleId: string) {
    const [likeCount, own] = await Promise.all([this.prisma.newsArticleLike.count({ where: { articleId } }), this.prisma.newsArticleLike.count({ where: { articleId, userId } })]);
    return { article_id: articleId, like_count: likeCount, is_liked: own > 0 };
  }
}
