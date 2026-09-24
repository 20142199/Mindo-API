import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewsAiSummaryService, normalizeNewsSummary } from './news-ai-summary.service';

describe('NewsAiSummaryService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('normalizes a numbered AI answer to at most five plain lines', () => {
    expect(normalizeNewsSummary('1. Dòng một.\n2. Dòng hai.\n3. Dòng ba.\n4. Dòng bốn.\n5. Dòng năm.\n6. Dòng sáu.')).toBe('Dòng một.\nDòng hai.\nDòng ba.\nDòng bốn.\nDòng năm.');
  });

  it('uses the configured provider and requests a Vietnamese 4-5 line summary', async () => {
    process.env.AI_MOCK = 'false';
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_API_BASE_URL = 'https://ai.example.test/v1';
    process.env.AI_CHAT_MODEL = 'summary-model';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Một.\nHai.\nBa.\nBốn.' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new NewsAiSummaryService().summarize('Tin thị trường', 'Nội dung nguồn đủ dài để tổng hợp.');

    expect(result).toBe('Một.\nHai.\nBa.\nBốn.');
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { model: string; messages: Array<{ content: string }> };
    expect(request.model).toBe('summary-model');
    expect(request.messages[0].content).toContain('4 đến 5 câu');
    expect(request.messages[1].content).toContain('Tin thị trường');
  });

  it('does not create fake summaries while AI mock mode is enabled', async () => {
    process.env.AI_MOCK = 'true';
    process.env.AI_API_KEY = '';
    await expect(new NewsAiSummaryService().summarize('Tiêu đề', 'Nội dung')).rejects.toThrow('không lưu bản tổng hợp giả');
  });
});
