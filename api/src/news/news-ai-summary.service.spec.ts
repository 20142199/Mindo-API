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

  it('uses structured output to create a complete Vietnamese editorial draft', async () => {
    process.env.AI_MOCK = 'false';
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_API_BASE_URL = 'https://ai.example.test/v1';
    process.env.AI_CHAT_MODEL = 'summary-model';
    const editorialContent = 'Đây là nội dung bài viết tiếng Việt đã được biên tập lại từ nguồn, giữ nguyên các dữ kiện và số liệu quan trọng. Nội dung được trình bày rõ ràng cho người đọc.';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ model: 'summary-model-2026', usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 }, choices: [{ message: { content: JSON.stringify({
        title: 'Tiêu đề tiếng Việt',
        short_summary: 'Mô tả ngắn bằng tiếng Việt.',
        summary_lines: ['Dòng một.', 'Dòng hai.', 'Dòng ba.', 'Dòng bốn.'],
        content: editorialContent,
      }) } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new NewsAiSummaryService().createEditorialDraft('Market news', 'Nội dung nguồn đủ dài để biên tập.');

    expect(result).toEqual({
      title: 'Tiêu đề tiếng Việt',
      summary: 'Mô tả ngắn bằng tiếng Việt.',
      aiSummary: 'Dòng một.\nDòng hai.\nDòng ba.\nDòng bốn.',
      content: editorialContent,
      model: 'summary-model-2026',
      usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
    });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      model: string;
      messages: Array<{ content: string }>;
      response_format: { type: string; json_schema: { strict: boolean; schema: { required: string[] } } };
    };
    expect(request.model).toBe('summary-model');
    expect(request.response_format.type).toBe('json_schema');
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.response_format.json_schema.schema.required).toEqual(['title', 'short_summary', 'summary_lines', 'content']);
    expect(request.messages[0].content).toContain('bản tin độc lập bằng tiếng Việt');
    expect(request.messages[1].content).toContain('Market news');
  });

  it('rejects an incomplete editorial response', async () => {
    process.env.AI_MOCK = 'false';
    process.env.AI_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        title: 'Tiêu đề', short_summary: 'Mô tả', summary_lines: ['Một.', 'Hai.'], content: 'Quá ngắn.',
      }) } }] }),
    }));

    await expect(new NewsAiSummaryService().createEditorialDraft('Tiêu đề nguồn', 'Nội dung nguồn')).rejects.toThrow('chưa đầy đủ');
  });

  it('does not create fake editorial content while AI mock mode is enabled', async () => {
    process.env.AI_MOCK = 'true';
    process.env.AI_API_KEY = '';
    await expect(new NewsAiSummaryService().createEditorialDraft('Tiêu đề', 'Nội dung')).rejects.toThrow('không lưu nội dung biên tập giả');
  });
});
