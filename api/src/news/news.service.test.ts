import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ArticleStatus, NewsContentType, NewsFeedbackType, Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { ListNewsDto } from './news.dto';
import { NewsService } from './news.service';

function articleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'article-1', title: 'Tiêu đề', slug: 'tieu-de', summary: 'Mô tả', aiSummary: 'Ý một.\nÝ hai.\nÝ ba.\nÝ bốn.',
    content: 'Nội dung', imageUrl: null, videoUrl: null, sourceUrl: 'https://finance.yahoo.com/news/a.html',
    contentType: NewsContentType.ARTICLE, status: ArticleStatus.PUBLISHED, topicId: 'topic-1', sourceId: 'source-1', expertId: null,
    publishedAt: new Date('2026-09-27T00:00:00Z'), createdAt: new Date('2026-09-27T00:00:00Z'), updatedAt: new Date('2026-09-27T00:00:00Z'),
    topic: { id: 'topic-1', name: 'Vĩ mô', slug: 'vi-mo' },
    source: { id: 'source-1', key: 'yahoo_finance', name: 'Yahoo Finance', baseUrl: 'https://finance.yahoo.com' },
    expert: null,
    _count: { likes: 3 },
    ...overrides,
  };
}

function setup() {
  const prisma = {
    newsArticle: {
      findMany: vi.fn().mockResolvedValue([articleRow()]),
      findFirst: vi.fn().mockResolvedValue(articleRow()),
      count: vi.fn().mockResolvedValue(1),
    },
    newsArticleFeedback: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    newsArticleLike: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    newsUserInterest: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    newsTopic: { count: vi.fn().mockResolvedValue(0) },
    newsAiSummaryUnlock: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    nftAsset: { count: vi.fn().mockResolvedValue(0) },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'user-1', fullName: 'Sơn', nickname: null, avatarFileId: null }) },
    newsExpertFollow: { findMany: vi.fn().mockResolvedValue([]) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(),
  };
  // `$transaction(fn)` chạy `fn` trên chính mock này, để kiểm được mọi lệnh
  // ghi bên trong transaction bằng cùng các spy ở trên.
  prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => unknown) => run(prisma));
  return { prisma, service: new NewsService(prisma as unknown as PrismaService) };
}

function listQuery(overrides: Partial<ListNewsDto> = {}) {
  return Object.assign(new ListNewsDto(), overrides);
}

function whereOf(prisma: ReturnType<typeof setup>['prisma']) {
  return prisma.newsArticle.findMany.mock.calls[0][0].where as Prisma.NewsArticleWhereInput;
}

describe('NewsService — lọc bài người dùng đã ẩn', () => {
  it('ẩn lĩnh vực hay nguồn không kéo theo bài chưa có lĩnh vực hay nguồn', async () => {
    /*
      Khoá lỗi cũ: `topicId: { notIn: [...] }` ra SQL `"topicId" NOT IN (...)`,
      mà NULL NOT IN (...) là NULL — mọi bài chưa có lĩnh vực biến mất ngay khi
      người dùng ẩn một lĩnh vực bất kỳ. Trên DB local: 218 bài còn 0.
    */
    const { prisma, service } = setup();
    prisma.newsArticleFeedback.findMany.mockResolvedValue([
      { type: NewsFeedbackType.NOT_INTERESTED, articleId: 'article-9', topicId: null, sourceId: null },
      { type: NewsFeedbackType.HIDE_TOPIC, articleId: 'article-8', topicId: 'topic-2', sourceId: null },
      { type: NewsFeedbackType.HIDE_SOURCE, articleId: 'article-7', topicId: null, sourceId: 'source-2' },
    ]);

    await service.listArticles(listQuery(), 'user-1');

    expect(whereOf(prisma).AND).toEqual(expect.arrayContaining([
      { id: { notIn: ['article-9'] } },
      { OR: [{ topicId: null }, { topicId: { notIn: ['topic-2'] } }] },
      { OR: [{ sourceId: null }, { sourceId: { notIn: ['source-2'] } }] },
    ]));
  });

  it('chưa ẩn gì thì không thêm điều kiện nào', async () => {
    const { prisma, service } = setup();
    await service.listArticles(listQuery(), 'user-1');
    expect(whereOf(prisma).AND).toEqual([]);
  });
});

describe('NewsService — tab "Dành cho bạn"', () => {
  it('chỉ lấy bài thuộc các lĩnh vực người dùng quan tâm', async () => {
    const { prisma, service } = setup();
    prisma.newsUserInterest.findMany.mockResolvedValue([{ topicId: 'topic-1' }, { topicId: 'topic-3' }]);

    await service.listArticles(listQuery({ feed: 'for_you' }), 'user-1');

    expect(whereOf(prisma).topicId).toEqual({ in: ['topic-1', 'topic-3'] });
  });

  it('chưa chọn lĩnh vực nào thì trả rỗng mà không truy vấn bài', async () => {
    const { prisma, service } = setup();

    const result = await service.listArticles(listQuery({ feed: 'for_you' }), 'user-1');

    expect(result.data).toEqual([]);
    expect(result.extra).toMatchObject({ total: 0, has_more: false });
    expect(prisma.newsArticle.findMany).not.toHaveBeenCalled();
  });

  it('chưa đăng nhập thì không có "Dành cho bạn"', async () => {
    const { service } = setup();
    await expect(service.listArticles(listQuery({ feed: 'for_you' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('NewsService — bản tóm tắt AI không lọt ra ngoài', () => {
  it('danh sách trả tên nguồn và cờ có tóm tắt, nhưng không trả nội dung tóm tắt', async () => {
    const { service } = setup();
    const { data } = await service.listArticles(listQuery(), 'user-1');
    expect(data[0]).toMatchObject({ ai_summary: null, has_ai_summary: true, source: { id: 'source-1', name: 'Yahoo Finance' } });
    expect(data[0].source).not.toHaveProperty('base_url');
  });

  it('trang admin vẫn thấy đủ bản tóm tắt và thông tin nguồn', async () => {
    const { service } = setup();
    const { data } = await service.listArticles(listQuery(), undefined, true);
    expect(data[0]).toMatchObject({ ai_summary: 'Ý một.\nÝ hai.\nÝ ba.\nÝ bốn.', source: { key: 'yahoo_finance', base_url: 'https://finance.yahoo.com' } });
  });

  it('chi tiết giấu tóm tắt khi người đọc chưa mở khoá', async () => {
    const { service } = setup();
    await expect(service.article('article-1', 'user-1')).resolves.toMatchObject({ ai_summary: null, ai_summary_unlocked: false, has_ai_summary: true });
  });

  it('chi tiết trả tóm tắt khi người đọc đã mở khoá bài đó', async () => {
    const { prisma, service } = setup();
    prisma.newsAiSummaryUnlock.count.mockResolvedValue(1);
    await expect(service.article('article-1', 'user-1')).resolves.toMatchObject({ ai_summary: 'Ý một.\nÝ hai.\nÝ ba.\nÝ bốn.', ai_summary_unlocked: true });
  });

  it('bài không có nguồn trả `source: null`', async () => {
    const { prisma, service } = setup();
    prisma.newsArticle.findMany.mockResolvedValue([articleRow({ source: null, sourceId: null, aiSummary: null })]);
    const { data } = await service.listArticles(listQuery(), 'user-1');
    expect(data[0]).toMatchObject({ source: null, has_ai_summary: false });
  });
});

describe('NewsService — hạn mức tóm tắt AI', () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.NEWS_AI_SUMMARY_MONTHLY_LIMIT;
    delete process.env.NEWS_AI_SUMMARY_LIMIT_PER_PEER;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...env };
  });

  it('tháng tính theo giờ Việt Nam: 23:30 UTC ngày 30/9 đã là tháng 10 ở Việt Nam', async () => {
    vi.setSystemTime(new Date('2026-09-30T23:30:00Z'));
    const { prisma, service } = setup();

    const usage = await service.aiSummaryUsage('user-1');

    expect(prisma.newsAiSummaryUnlock.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', createdAt: { gte: new Date('2026-09-30T17:00:00Z') } },
    });
    expect(usage).toMatchObject({ period: 'monthly', timezone: 'Asia/Ho_Chi_Minh', reset_at: '2026-10-31T17:00:00.000Z' });
  });

  it('mặc định 10 lượt, mỗi Peer cộng 5', async () => {
    vi.setSystemTime(new Date('2026-09-28T03:00:00Z'));
    const { prisma, service } = setup();
    prisma.newsAiSummaryUnlock.count.mockResolvedValue(4);
    prisma.nftAsset.count.mockResolvedValue(2);

    await expect(service.aiSummaryUsage('user-1')).resolves.toMatchObject({
      used: 4, limit: 20, remaining: 16, can_use: true, base_limit: 10, peer_owned: 2, peer_bonus_per_item: 5, peer_bonus_limit: 10,
    });
  });

  it('đọc được hạn mức từ env', async () => {
    vi.setSystemTime(new Date('2026-09-28T03:00:00Z'));
    process.env.NEWS_AI_SUMMARY_MONTHLY_LIMIT = '3';
    process.env.NEWS_AI_SUMMARY_LIMIT_PER_PEER = '0';
    const { prisma, service } = setup();
    prisma.nftAsset.count.mockResolvedValue(4);

    await expect(service.aiSummaryUsage('user-1')).resolves.toMatchObject({ limit: 3, peer_bonus_limit: 0 });
  });
});

describe('NewsService — mở khoá bản tóm tắt AI', () => {
  it('lần đầu mở một bài thì trừ một lượt', async () => {
    const { prisma, service } = setup();
    prisma.newsAiSummaryUnlock.count.mockResolvedValueOnce(2).mockResolvedValueOnce(3);

    const result = await service.unlockAiSummary('user-1', 'article-1');

    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.newsAiSummaryUnlock.create).toHaveBeenCalledWith({ data: { userId: 'user-1', articleId: 'article-1' } });
    expect(result).toMatchObject({ article_id: 'article-1', ai_summary: 'Ý một.\nÝ hai.\nÝ ba.\nÝ bốn.', charged: true, usage: { used: 3, remaining: 7 } });
  });

  it('mở lại bài đã mở thì không trừ nữa', async () => {
    const { prisma, service } = setup();
    prisma.newsAiSummaryUnlock.findUnique.mockResolvedValue({ userId: 'user-1', articleId: 'article-1' });
    prisma.newsAiSummaryUnlock.count.mockResolvedValue(10);

    const result = await service.unlockAiSummary('user-1', 'article-1');

    expect(prisma.newsAiSummaryUnlock.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ charged: false, ai_summary: 'Ý một.\nÝ hai.\nÝ ba.\nÝ bốn.' });
  });

  it('hết lượt thì báo lỗi có `code` để app mở đúng trạng thái "hết lượt"', async () => {
    const { prisma, service } = setup();
    prisma.newsAiSummaryUnlock.count.mockResolvedValue(10);

    const error = await service.unlockAiSummary('user-1', 'article-1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'NEWS_AI_SUMMARY_LIMIT_REACHED', used: 10, limit: 10 });
    expect(prisma.newsAiSummaryUnlock.create).not.toHaveBeenCalled();
  });

  it('bài chưa có bản tóm tắt thì không cho mở và không trừ lượt', async () => {
    const { prisma, service } = setup();
    prisma.newsArticle.findFirst.mockResolvedValue(articleRow({ aiSummary: '  ' }));

    await expect(service.unlockAiSummary('user-1', 'article-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.newsAiSummaryUnlock.create).not.toHaveBeenCalled();
  });
});

describe('NewsService — ẩn nguồn và ẩn lĩnh vực', () => {
  it('ẩn nguồn thì lưu nguồn của bài', async () => {
    const { prisma, service } = setup();

    await service.feedback('user-1', 'article-1', { type: NewsFeedbackType.HIDE_SOURCE });

    expect(prisma.newsArticleFeedback.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ type: NewsFeedbackType.HIDE_SOURCE, sourceId: 'source-1', topicId: undefined }),
    }));
  });

  it('bài không có nguồn thì không ẩn nguồn được', async () => {
    const { prisma, service } = setup();
    prisma.newsArticle.findFirst.mockResolvedValue(articleRow({ sourceId: null, source: null }));

    await expect(service.feedback('user-1', 'article-1', { type: NewsFeedbackType.HIDE_SOURCE })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.newsArticleFeedback.upsert).not.toHaveBeenCalled();
  });

  it('ẩn lĩnh vực thì bỏ luôn lĩnh vực đó khỏi danh sách quan tâm', async () => {
    const { prisma, service } = setup();

    await service.feedback('user-1', 'article-1', { type: NewsFeedbackType.HIDE_TOPIC });

    expect(prisma.newsArticleFeedback.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ topicId: 'topic-1', sourceId: undefined }),
    }));
    expect(prisma.newsUserInterest.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', topicId: 'topic-1' } });
  });

  it('chọn lại một lĩnh vực đã ẩn thì hết ẩn', async () => {
    const { prisma, service } = setup();
    prisma.newsTopic.count.mockResolvedValue(2);

    await service.setInterests('user-1', ['topic-1', 'topic-2']);

    expect(prisma.newsArticleFeedback.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', type: NewsFeedbackType.HIDE_TOPIC, topicId: { in: ['topic-1', 'topic-2'] } },
    });
  });

  it('`GET news/me` trả các lĩnh vực đã ẩn để app bỏ chip của chúng', async () => {
    const { prisma, service } = setup();
    prisma.newsArticleFeedback.findMany.mockResolvedValue([
      { type: NewsFeedbackType.HIDE_TOPIC, articleId: 'article-8', topicId: 'topic-2', sourceId: null },
      { type: NewsFeedbackType.HIDE_TOPIC, articleId: 'article-6', topicId: 'topic-2', sourceId: null },
    ]);

    await expect(service.profile('user-1')).resolves.toMatchObject({ hidden_topic_ids: ['topic-2'] });
  });
});
