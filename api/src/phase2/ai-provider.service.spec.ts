import { AiExpert, AiMessageKind } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiProviderService } from './ai-provider.service';

const expert = {
  id: 'expert-1', name: 'Mindo Finance', slug: 'mindo-finance', specialty: 'Tài chính',
  description: 'Trợ lý tài chính', avatarUrl: null, systemPrompt: 'Trả lời rõ ràng bằng tiếng Việt.',
  capabilities: ['CHAT', 'TRANSLATION'], isActive: true, createdAt: new Date(), updatedAt: new Date(),
} satisfies AiExpert;

describe('AiProviderService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('uses Gemini Native with history and inline PDF data', async () => {
    process.env.AI_MOCK = 'false';
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.GEMINI_NATIVE_BASE_URL = 'https://gemini.example.test/v1beta';
    process.env.GEMINI_MODEL = 'gemini-test';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Nội dung trong file nói về tài chính.' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7, thoughtsTokenCount: 2, totalTokenCount: 21 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AiProviderService().generate(expert, AiMessageKind.CHAT, 'Tóm tắt file này', {
      history: [{ role: 'user', content: 'Xin chào' }, { role: 'assistant', content: 'Chào bạn' }],
      attachment: { name: 'bao-cao.pdf', mimeType: 'application/pdf', content: Buffer.from('pdf') },
    });

    expect(result.content).toBe('Nội dung trong file nói về tài chính.');
    expect(result.metadata).toMatchObject({ vendor: 'gemini', model: 'gemini-test', input_tokens: 12, output_tokens: 9, total_tokens: 21, fallback_used: false });
    expect(fetchMock.mock.calls[0][0]).toBe('https://gemini.example.test/v1beta/models/gemini-test:generateContent');
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    expect(request.systemInstruction.parts[0].text).toContain('Trả lời rõ ràng');
    expect(request.contents.slice(0, 2).map((item) => item.role)).toEqual(['user', 'model']);
    expect(request.contents[2].parts).toEqual([
      { inline_data: { mime_type: 'application/pdf', data: 'cGRm' } },
      { text: 'Tóm tắt file này' },
    ]);
  });

  it('falls back from Gemini to DeepSeek for text requests', async () => {
    process.env.AI_MOCK = 'false';
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    process.env.LLM_PRIMARY_VENDOR = 'gemini';
    process.env.LLM_FALLBACK_VENDOR = 'deepseek';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'deepseek-chat', choices: [{ message: { content: 'Câu trả lời dự phòng.' } }], usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AiProviderService().generate(expert, AiMessageKind.CHAT, 'Xin chào');

    expect(result.content).toBe('Câu trả lời dự phòng.');
    expect(result.metadata).toMatchObject({ vendor: 'deepseek', primary_vendor: 'gemini', fallback_used: true, total_tokens: 13 });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.deepseek.com/chat/completions');
  });

  it('does not silently drop an attachment when Gemini fails', async () => {
    process.env.AI_MOCK = 'false';
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(new AiProviderService().generate(expert, AiMessageKind.CHAT, 'Đọc file', {
      attachment: { name: 'bao-cao.pdf', mimeType: 'application/pdf', content: Buffer.from('pdf') },
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'LLM_BOTH_DOWN' }) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('generates images with the Gemini native image model', async () => {
    process.env.AI_MOCK = 'false';
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.GEMINI_IMAGE_MODEL = 'gemini-image-test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 4 } }),
    }));

    const result = await new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'Một căn nhà màu xanh');

    expect(result.attachmentUrl).toBe('data:image/png;base64,aW1hZ2U=');
    expect(result.metadata).toMatchObject({ vendor: 'gemini', model: 'gemini-image-test', input_tokens: 2, output_tokens: 4 });
  });

  it('adds translation instructions to Gemini systemInstruction', async () => {
    process.env.AI_MOCK = 'false';
    process.env.GEMINI_API_KEY = 'gemini-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Hello' }] } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AiProviderService().generate(expert, AiMessageKind.TRANSLATION, 'Xin chào', {
      sourceLanguage: 'Tiếng Việt', targetLanguage: 'English',
    });

    expect(result.metadata).toMatchObject({ vendor: 'gemini', source_language: 'Tiếng Việt', target_language: 'English' });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { systemInstruction: { parts: Array<{ text: string }> } };
    expect(request.systemInstruction.parts[0].text).toContain('Tiếng Việt');
    expect(request.systemInstruction.parts[0].text).toContain('English');
  });

  it('keeps mock responses local when providers are disabled', async () => {
    process.env.AI_MOCK = 'true';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await new AiProviderService().generate(expert, AiMessageKind.CHAT, 'Giá vàng hôm nay?');
    expect(result.content).toContain('Mindo Finance');
    expect(result.metadata).toMatchObject({ vendor: 'mock', model: 'mindo-local-mock' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
