import { BadRequestException, ConflictException } from '@nestjs/common';
import { NewsEditorialStatus } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { NewsAiSummaryService } from './news-ai-summary.service';
import { NewsCrawlService } from './news-crawl.service';

function setup(article: Record<string, unknown>) {
  const prisma = {
    newsArticle: {
      findUnique: vi.fn().mockResolvedValue(article),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'article-1', ...data })),
    },
    newsTopic: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'topic-macro', slug: 'vi-mo', name: 'Vĩ mô' },
        { id: 'topic-stocks', slug: 'chung-khoan', name: 'Chứng khoán' },
      ]),
    },
  };
  const ai = {
    isConfigured: vi.fn().mockReturnValue(true),
    configurationError: vi.fn().mockReturnValue('Chưa cấu hình AI'),
    createEditorialDraft: vi.fn().mockResolvedValue({
      title: 'Bản tin tiếng Việt',
      summary: 'Mô tả tiếng Việt',
      aiSummary: 'Một.\nHai.\nBa.\nBốn.',
      content: 'Nội dung tiếng Việt đã được biên tập đầy đủ để hiển thị trên ứng dụng Mindo.',
      model: 'gpt-test',
      usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
      topicSlug: 'vi-mo',
    }),
  };
  return {
    prisma,
    ai,
    service: new NewsCrawlService(prisma as unknown as PrismaService, ai as unknown as NewsAiSummaryService),
  };
}

describe('NewsCrawlService manual AI editorial', () => {
  it('claims an article for processing only after an admin request', async () => {
    const { service, prisma, ai } = setup({ id: 'article-1', sourceContent: 'Source body', aiEditorialStatus: NewsEditorialStatus.NOT_REQUESTED });
    await expect(service.prepareEditorial('article-1')).resolves.toEqual({ article_id: 'article-1', status: NewsEditorialStatus.PROCESSING });
    expect(ai.createEditorialDraft).not.toHaveBeenCalled();
    expect(prisma.newsArticle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { aiEditorialStatus: NewsEditorialStatus.PROCESSING, aiEditorialError: null },
    }));
  });

  it('requires explicit force before overwriting a ready editorial', async () => {
    const { service } = setup({ id: 'article-1', sourceContent: 'Source body', aiEditorialStatus: NewsEditorialStatus.READY });
    await expect(service.prepareEditorial('article-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate processing requests', async () => {
    const { service } = setup({ id: 'article-1', sourceContent: 'Source body', aiEditorialStatus: NewsEditorialStatus.PROCESSING });
    await expect(service.prepareEditorial('article-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores the Vietnamese draft and token usage when the queued job completes', async () => {
    const { service, prisma } = setup({ id: 'article-1', sourceTitle: 'Source title', sourceContent: 'Source body', externalKey: '1234567890abcdef' });
    await service.editorializeArticleById('article-1');
    expect(prisma.newsArticle.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: 'Bản tin tiếng Việt',
        aiEditorialStatus: NewsEditorialStatus.READY,
        aiEditorialModel: 'gpt-test',
        aiEditorialInputTokens: 120,
        aiEditorialOutputTokens: 80,
        aiEditorialTotalTokens: 200,
      }),
    }));
  });

  it('gives an article without a topic the one the AI picked', async () => {
    const { service, prisma, ai } = setup({ id: 'article-1', sourceTitle: 'Source title', sourceContent: 'Source body', externalKey: 'abc', topicId: null });
    await service.editorializeArticleById('article-1');
    expect(ai.createEditorialDraft).toHaveBeenCalledWith('Source title', 'Source body', [{ slug: 'vi-mo', name: 'Vĩ mô' }, { slug: 'chung-khoan', name: 'Chứng khoán' }]);
    expect(prisma.newsArticle.update.mock.calls[0][0].data.topicId).toBe('topic-macro');
  });

  it('never overrides a topic an admin already set', async () => {
    const { service, prisma } = setup({ id: 'article-1', sourceTitle: 'Source title', sourceContent: 'Source body', externalKey: 'abc', topicId: 'topic-stocks' });
    await service.editorializeArticleById('article-1');
    expect(prisma.newsArticle.update.mock.calls[0][0].data).not.toHaveProperty('topicId');
  });

  it('leaves the topic empty when the AI found no fitting one', async () => {
    const { service, prisma, ai } = setup({ id: 'article-1', sourceTitle: 'Source title', sourceContent: 'Source body', externalKey: 'abc', topicId: null });
    ai.createEditorialDraft.mockResolvedValueOnce({ ...(await ai.createEditorialDraft()), topicSlug: null });
    await service.editorializeArticleById('article-1');
    expect(prisma.newsArticle.update.mock.calls[0][0].data.topicId).toBeNull();
  });
});

describe('NewsCrawlService image check', () => {
  const service = setup({}).service;
  const reply = (status: number, contentType: string) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType }),
    body: { cancel: vi.fn().mockResolvedValue(undefined) },
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps an image the app can actually load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, 'image/jpeg')));
    await expect(service.usableImageUrl('https://media.zenfs.com/a.jpg')).resolves.toBe('https://media.zenfs.com/a.jpg');
  });

  it('drops a link that answers with a block page instead of an image', async () => {
    // Forex Factory: mọi og:image là `…/image` và trả 403 kèm trang HTML của Cloudflare.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(403, 'text/html; charset=UTF-8')));
    await expect(service.usableImageUrl('https://www.forexfactory.com/news/1-x/image')).resolves.toBeUndefined();
  });

  it('drops HTML served with 200, SVG, plain http and unreachable hosts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, 'text/html')));
    await expect(service.usableImageUrl('https://example.com/a')).resolves.toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, 'image/svg+xml')));
    await expect(service.usableImageUrl('https://example.com/a.svg')).resolves.toBeUndefined();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(service.usableImageUrl('http://example.com/a.jpg')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')));
    await expect(service.usableImageUrl('https://gone.example.com/a.jpg')).resolves.toBeUndefined();
    await expect(service.usableImageUrl(undefined)).resolves.toBeUndefined();
  });
});

