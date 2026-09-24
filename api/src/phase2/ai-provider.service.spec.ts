import { AiExpert, AiMessageKind } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiProviderService } from './ai-provider.service';

const expert = {
  id: 'expert-1',
  name: 'Mindo Finance',
  slug: 'mindo-finance',
  specialty: 'Tài chính',
  description: 'Trợ lý tài chính',
  avatarUrl: null,
  systemPrompt: 'Trả lời rõ ràng bằng tiếng Việt.',
  capabilities: ['CHAT', 'TRANSLATION'],
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies AiExpert;

describe('AiProviderService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('sends conversation context and an owned PDF as a file content part', async () => {
    process.env.AI_MOCK = 'false';
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_API_BASE_URL = 'https://ai.example.test/v1';
    process.env.AI_CHAT_MODEL = 'chat-model';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'chat-model-2026',
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
        choices: [{ message: { content: 'Nội dung trong file nói về tài chính.' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AiProviderService().generate(expert, AiMessageKind.CHAT, 'Tóm tắt file này', {
      history: [{ role: 'user', content: 'Xin chào' }, { role: 'assistant', content: 'Chào bạn' }],
      attachment: { name: 'bao-cao.pdf', mimeType: 'application/pdf', content: Buffer.from('pdf') },
    });

    expect(result.content).toBe('Nội dung trong file nói về tài chính.');
    expect(result.metadata).toMatchObject({ model: 'chat-model-2026', input_tokens: 12, output_tokens: 7, total_tokens: 19 });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
    };
    expect(request.messages.slice(1, 3)).toEqual([
      { role: 'user', content: 'Xin chào' },
      { role: 'assistant', content: 'Chào bạn' },
    ]);
    expect(request.messages[3].content).toEqual([
      { type: 'file', file: { filename: 'bao-cao.pdf', file_data: 'data:application/pdf;base64,cGRm' } },
      { type: 'text', text: 'Tóm tắt file này' },
    ]);
  });

  it('adds source and target language instructions and usage metadata', async () => {
    process.env.AI_MOCK = 'false';
    process.env.AI_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Hello' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AiProviderService().generate(expert, AiMessageKind.TRANSLATION, 'Xin chào', {
      sourceLanguage: 'Tiếng Việt',
      targetLanguage: 'English',
    });

    expect(result.metadata).toMatchObject({ source_language: 'Tiếng Việt', target_language: 'English', character_count: 8, credits: 1 });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { messages: Array<{ content: string }> };
    expect(request.messages[0].content).toContain('Tiếng Việt');
    expect(request.messages[0].content).toContain('English');
  });

  it('keeps mock responses local when the provider is disabled', async () => {
    process.env.AI_MOCK = 'true';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AiProviderService().generate(expert, AiMessageKind.CHAT, 'Giá vàng hôm nay?');

    expect(result.content).toContain('Mindo Finance');
    expect(result.metadata).toMatchObject({ model: 'mindo-local-mock', credits: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
