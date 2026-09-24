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
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_NATIVE_BASE_URL = 'https://gemini.example.test/v1beta';
    process.env.NEWS_AI_SUMMARY_MODEL = 'summary-model';
    const editorialContent = 'Đây là nội dung bài viết tiếng Việt đã được biên tập lại từ nguồn, giữ nguyên các dữ kiện và số liệu quan trọng. Nội dung được trình bày rõ ràng cho người đọc.';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 70, thoughtsTokenCount: 10, totalTokenCount: 200 },
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          title: 'Tiêu đề tiếng Việt',
          short_summary: 'Mô tả ngắn bằng tiếng Việt.',
          summary_lines: ['Dòng một.', 'Dòng hai.', 'Dòng ba.', 'Dòng bốn.'],
          content: editorialContent,
        }) }] } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new NewsAiSummaryService().createEditorialDraft('Market news', 'Nội dung nguồn đủ dài để biên tập.');

    expect(result).toEqual({
      title: 'Tiêu đề tiếng Việt',
      summary: 'Mô tả ngắn bằng tiếng Việt.',
      aiSummary: 'Dòng một.\nDòng hai.\nDòng ba.\nDòng bốn.',
      content: editorialContent,
      model: 'gemini/summary-model',
      usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
    });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig: { responseMimeType: string; responseSchema: { required: string[] } };
    };
    expect(fetchMock.mock.calls[0][0]).toBe('https://gemini.example.test/v1beta/models/summary-model:generateContent');
    expect(request.generationConfig.responseMimeType).toBe('application/json');
    expect(request.generationConfig.responseSchema.required).toEqual(['title', 'short_summary', 'summary_lines', 'content']);
    expect(request.systemInstruction.parts[0].text).toContain('bản tin độc lập bằng tiếng Việt');
    expect(request.contents[0].parts[0].text).toContain('Market news');
  });

  it('rejects an incomplete editorial response', async () => {
    process.env.AI_MOCK = 'false';
    process.env.GEMINI_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        title: 'Tiêu đề', short_summary: 'Mô tả', summary_lines: ['Một.', 'Hai.'], content: 'Quá ngắn.',
      }) }] } }] }),
    }));

    await expect(new NewsAiSummaryService().createEditorialDraft('Tiêu đề nguồn', 'Nội dung nguồn')).rejects.toThrow('chưa đầy đủ');
  });

  it('does not create fake editorial content while AI mock mode is enabled', async () => {
    process.env.AI_MOCK = 'true';
    process.env.GEMINI_API_KEY = '';
    process.env.DEEPSEEK_API_KEY = '';
    await expect(new NewsAiSummaryService().createEditorialDraft('Tiêu đề', 'Nội dung')).rejects.toThrow('không lưu nội dung biên tập giả');
  });
});
