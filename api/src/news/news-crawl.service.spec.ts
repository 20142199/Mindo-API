import { BadRequestException, ConflictException } from '@nestjs/common';
import { NewsEditorialStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
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
});
