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

    expect(result.attachmentData).toMatchObject({ mimeType: 'image/png' });
    expect(result.attachmentData?.content.toString()).toBe('image');
    expect(result.metadata).toMatchObject({ vendor: 'gemini', model: 'gemini-image-test', input_tokens: 2, output_tokens: 4 });
  });

  /*
    Tạo ảnh không còn đóng cứng vào Gemini. Lý do rất cụ thể: key Gemini hiện
    tại gọi model chat thì 200, gọi model ảnh thì 429 với `limit: 0` — bậc
    miễn phí KHÔNG cấp suất tạo ảnh, đợi sang ngày cũng vẫn 0. Phải bật thanh
    toán mới dùng được, mà lúc này chưa có.

    Nên `IMAGE_VENDOR` tách riêng khỏi `LLM_PRIMARY_VENDOR`: chữ và ảnh không
    nhất thiết mua của cùng một nhà. Mặc định vẫn là gemini để không đổi hành
    vi sau lưng ai; muốn khác thì phải khai báo.
  */
  it('mặc định vẫn tạo ảnh bằng Gemini khi không khai IMAGE_VENDOR', async () => {
    process.env.AI_MOCK = 'false';
    process.env.GEMINI_API_KEY = 'gemini-key';
    delete process.env.IMAGE_VENDOR;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'nhà xanh');

    expect(result.metadata).toMatchObject({ vendor: 'gemini' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('generativelanguage');
  });

  it('IMAGE_VENDOR=pollinations thì gọi Pollinations và KHÔNG cần API key', async () => {
    /* Nhà duy nhất chạy được ngay khi chưa ai cấp key — dùng để thông luồng */
    process.env.AI_MOCK = 'false';
    delete process.env.GEMINI_API_KEY;
    process.env.IMAGE_VENDOR = 'pollinations';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
      arrayBuffer: async () => new TextEncoder().encode('anh-gia').buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'mèo đen đội mũ');

    expect(result.attachmentData?.content.toString()).toBe('anh-gia');
    expect(result.attachmentData?.mimeType).toBe('image/jpeg');
    expect(result.metadata).toMatchObject({ vendor: 'pollinations' });
    const [url, init] = fetchMock.mock.calls[0] as [string, { method?: string; headers?: Record<string, string> }];
    expect(url).toContain('image.pollinations.ai/prompt/');
    /* GET, không phải POST-JSON như các nhà kia */
    expect(init?.method ?? 'GET').toBe('GET');
    /* Không được gắn Authorization: không có key nào để gắn, gắn bừa là 401 */
    expect(JSON.stringify(init?.headers ?? {})).not.toContain('Authorization');
  });

  it('mô tả ảnh được escape vào đường dẫn, không vỡ URL', async () => {
    /*
      Pollinations nhận mô tả NẰM TRONG path chứ không phải query. Dấu cách,
      dấu tiếng Việt, dấu `/` và `?` của người dùng mà không escape thì hoặc
      gãy URL hoặc lạc sang endpoint khác.
    */
    process.env.AI_MOCK = 'false';
    process.env.IMAGE_VENDOR = 'pollinations';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new TextEncoder().encode('x').buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    await new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'mèo/chó? đội mũ');

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(encodeURIComponent('mèo/chó? đội mũ'));
    /* phần sau `?` phải là tham số của mình, không phải mẩu câu hỏi lọt ra */
    expect(url.split('?')[1] ?? '').not.toContain('đội');
  });

  it('Pollinations hỏng thì báo lỗi có mã riêng, không đội lốt Gemini', async () => {
    process.env.AI_MOCK = 'false';
    process.env.IMAGE_VENDOR = 'pollinations';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, headers: { get: () => null } }));

    await expect(
      new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'mèo'),
    ).rejects.toMatchObject({ response: { code: 'POLLINATIONS_IMAGE_FAILED' } });
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

  it('translates only the new input, never the earlier turns of the session', async () => {
    /* Found on staging 28/09/2026: a Vietnamese → Korean request came back with
       "사랑해" ("Anh yêu em", an earlier turn) and the previous meeting note
       translated above the requested text. */
    process.env.AI_MOCK = 'false';
    process.env.GEMINI_API_KEY = 'gemini-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '감사합니다' }] } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await new AiProviderService().generate(expert, AiMessageKind.TRANSLATION, 'Cảm ơn bạn', {
      sourceLanguage: 'Tiếng Việt',
      targetLanguage: '한국어',
      history: [{ role: 'user', content: 'Anh yêu em' }, { role: 'assistant', content: 'I love you' }],
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { contents: Array<{ parts: Array<{ text: string }> }> };
    expect(request.contents).toHaveLength(1);
    expect(request.contents[0].parts[0].text).toBe('Cảm ơn bạn');
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

  it('streams accumulated Gemini text to the caller', async () => {
    process.env.AI_MOCK = 'false';
    process.env.GEMINI_API_KEY = 'gemini-key';
    const stream = [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Xin ' }] } }] })}\n\n`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'chào' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2, totalTokenCount: 4 } })}\n\n`,
    ].join('');
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const deltas: string[] = [];

    const result = await new AiProviderService().generate(expert, AiMessageKind.CHAT, 'Chào', {
      onDelta: async (content) => { deltas.push(content); },
    });

    expect(fetchMock.mock.calls[0][0]).toContain(':streamGenerateContent?alt=sse');
    expect(deltas).toEqual(['Xin ', 'Xin chào']);
    expect(result.content).toBe('Xin chào');
    expect(result.metadata).toMatchObject({ total_tokens: 4 });
  });
  it('Pollinations: tỷ lệ 9:16 ra width/height dọc, phong cách nối vào mô tả', async () => {
    process.env.AI_MOCK = 'false';
    process.env.IMAGE_VENDOR = 'pollinations';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new TextEncoder().encode('x').buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'robot', {
      imageStyle: 'THREE_D', aspectRatio: '9:16',
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('width')).toBe('768');
    expect(url.searchParams.get('height')).toBe('1344');
    expect(decodeURIComponent(url.pathname)).toContain('3D render');
    expect(result.metadata).toMatchObject({ width: 768, height: 1344 });
  });

  it('Pollinations: không truyền tuỳ chọn thì vuông 1024 và giữ nguyên mô tả', async () => {
    process.env.AI_MOCK = 'false';
    process.env.IMAGE_VENDOR = 'pollinations';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new TextEncoder().encode('x').buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    await new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'robot');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('width')).toBe('1024');
    expect(url.searchParams.get('height')).toBe('1024');
    expect(decodeURIComponent(url.pathname)).toBe('/prompt/robot');
  });

  it('Gemini: tỷ lệ đi vào generationConfig.imageConfig.aspectRatio', async () => {
    process.env.AI_MOCK = 'false';
    process.env.GEMINI_API_KEY = 'gemini-key';
    delete process.env.IMAGE_VENDOR;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'robot', { aspectRatio: '4:3' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: '4:3' });
  });
  it('Pollinations: mỗi lần gọi một seed ngẫu nhiên — "Tạo lại" phải ra ảnh KHÁC', async () => {
    /*
      Pollinations trả kết quả cố định theo (mô tả, tham số). Không có seed thì
      bấm "Tạo lại" nhận về đúng tấm cũ từng byte — đo trên máy ngày 28/09/2026:
      hai lần tạo cùng md5, cùng 25.930 byte.
    */
    process.env.AI_MOCK = 'false';
    process.env.IMAGE_VENDOR = 'pollinations';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new TextEncoder().encode('x').buffer,
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new AiProviderService();

    const first = await service.generate(expert, AiMessageKind.IMAGE, 'robot');
    const second = await service.generate(expert, AiMessageKind.IMAGE, 'robot');

    const seedOf = (call: number) => new URL(String(fetchMock.mock.calls[call][0])).searchParams.get('seed');
    expect(seedOf(0)).toMatch(/^\d+$/);
    expect(seedOf(0)).not.toBe(seedOf(1));
    /* ghi lại để lần sau muốn tái hiện đúng tấm đó thì còn có số */
    expect(first.metadata?.seed).toBe(Number(seedOf(0)));
    expect(second.metadata?.seed).toBe(Number(seedOf(1)));
  });

  describe('OpenAI', () => {
    const chatOk = (content: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ model: 'gpt-4.1-mini-2025-04-14', choices: [{ message: { content } }], usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 } }),
    });

    it('LLM_PRIMARY_VENDOR=openai gọi Chat Completions với khoá Bearer và model mặc định', async () => {
      process.env.AI_MOCK = 'false';
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.LLM_PRIMARY_VENDOR = 'OpenAI';
      process.env.LLM_FALLBACK_VENDOR = 'gemini';
      delete process.env.OPENAI_MODEL;
      const fetchMock = vi.fn().mockResolvedValue(chatOk('Xin chào bạn.'));
      vi.stubGlobal('fetch', fetchMock);

      const result = await new AiProviderService().generate(expert, AiMessageKind.CHAT, 'Xin chào', {
        history: [{ role: 'user', content: 'Trước đó' }, { role: 'assistant', content: 'Đã rõ' }],
      });

      expect(result.content).toBe('Xin chào bạn.');
      expect(result.metadata).toMatchObject({ vendor: 'openai', primary_vendor: 'openai', fallback_used: false, total_tokens: 13 });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(init.headers.authorization).toBe('Bearer openai-key');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('gpt-4.1-mini');
      expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
      /* OpenAI đã bỏ `max_tokens` ở các model mới — phải dùng max_completion_tokens */
      expect(body.max_completion_tokens).toBeGreaterThan(0);
      expect(body.max_tokens).toBeUndefined();
    });

    it('model họ gpt-5 không nhận temperature tuỳ chỉnh — không gửi', async () => {
      process.env.AI_MOCK = 'false';
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.LLM_PRIMARY_VENDOR = 'openai';
      process.env.OPENAI_MODEL = 'gpt-5-mini';
      const fetchMock = vi.fn().mockResolvedValue(chatOk('OK'));
      vi.stubGlobal('fetch', fetchMock);

      await new AiProviderService().generate(expert, AiMessageKind.CHAT, 'Xin chào');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.model).toBe('gpt-5-mini');
      expect(body.temperature).toBeUndefined();
    });

    it('OpenAI hỏng thì lùi về Gemini', async () => {
      process.env.AI_MOCK = 'false';
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.GEMINI_API_KEY = 'gemini-key';
      process.env.LLM_PRIMARY_VENDOR = 'openai';
      process.env.LLM_FALLBACK_VENDOR = 'gemini';
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Gemini trả lời.' }] } }] }) });
      vi.stubGlobal('fetch', fetchMock);

      const result = await new AiProviderService().generate(expert, AiMessageKind.CHAT, 'Xin chào');

      expect(result.content).toBe('Gemini trả lời.');
      expect(result.metadata).toMatchObject({ vendor: 'gemini', primary_vendor: 'openai', fallback_used: true });
    });

    it('gửi ảnh đính kèm dạng image_url và PDF dạng file cho OpenAI', async () => {
      process.env.AI_MOCK = 'false';
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.LLM_PRIMARY_VENDOR = 'openai';
      const fetchMock = vi.fn().mockResolvedValue(chatOk('Đã đọc.'));
      vi.stubGlobal('fetch', fetchMock);
      const service = new AiProviderService();

      await service.generate(expert, AiMessageKind.CHAT, 'Ảnh này là gì?', {
        attachment: { name: 'a.png', mimeType: 'image/png', content: Buffer.from('png-bytes') },
      });
      await service.generate(expert, AiMessageKind.CHAT, 'Tóm tắt giúp', {
        attachment: { name: 'bao-cao.pdf', mimeType: 'application/pdf', content: Buffer.from('pdf-bytes') },
      });

      const imageTurn = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages.at(-1);
      expect(imageTurn.content).toEqual([
        { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}` } },
        { type: 'text', text: 'Ảnh này là gì?' },
      ]);
      const pdfTurn = JSON.parse(fetchMock.mock.calls[1][1].body as string).messages.at(-1);
      expect(pdfTurn.content[0]).toEqual({
        type: 'file',
        file: { filename: 'bao-cao.pdf', file_data: `data:application/pdf;base64,${Buffer.from('pdf-bytes').toString('base64')}` },
      });
    });

    it('đặt tiêu đề ảnh bằng OpenAI khi nó là nhà chính', async () => {
      process.env.AI_MOCK = 'false';
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.LLM_PRIMARY_VENDOR = 'openai';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(chatOk('"Đèn lồng Hội An".')));

      await expect(new AiProviderService().summarizeTitle('Phố cổ Hội An về đêm')).resolves.toBe('Đèn lồng Hội An');
    });

    it.each([
      ['1:1', '1024x1024', 1024, 1024],
      ['4:3', '1536x1024', 1536, 1024],
      ['9:16', '1024x1536', 1024, 1536],
    ] as const)('IMAGE_VENDOR=openai: tỷ lệ %s xin kích thước %s', async (ratio, size, width, height) => {
      process.env.AI_MOCK = 'false';
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.IMAGE_VENDOR = 'openai';
      delete process.env.OPENAI_IMAGE_MODEL;
      delete process.env.OPENAI_IMAGE_QUALITY;
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ b64_json: Buffer.from('jpeg-bytes').toString('base64') }], usage: { input_tokens: 20, output_tokens: 400, total_tokens: 420 } }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'Robot Mindo', {
        aspectRatio: ratio,
        imageStyle: 'THREE_D',
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/images/generations');
      expect(init.headers.authorization).toBe('Bearer openai-key');
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({ model: 'gpt-image-1', size, quality: 'medium', n: 1, output_format: 'jpeg' });
      /* phong cách vẫn được ghép vào mô tả như mọi nhà khác */
      expect(body.prompt).toContain('Robot Mindo');
      expect(body.prompt).not.toBe('Robot Mindo');
      expect(result.attachmentData?.mimeType).toBe('image/jpeg');
      expect(result.attachmentData?.filename).toMatch(/\.jpg$/);
      expect(result.attachmentData?.content.toString()).toBe('jpeg-bytes');
      expect(result.metadata).toMatchObject({ vendor: 'openai', model: 'gpt-image-1', width, height, total_tokens: 420 });
    });

    it('IMAGE_VENDOR=openai mà thiếu khoá hoặc OpenAI hỏng thì báo lỗi có mã riêng', async () => {
      process.env.AI_MOCK = 'false';
      process.env.IMAGE_VENDOR = 'openai';
      delete process.env.OPENAI_API_KEY;
      vi.stubGlobal('fetch', vi.fn());
      await expect(new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'mèo'))
        .rejects.toMatchObject({ response: { code: 'OPENAI_NOT_CONFIGURED' } });

      process.env.OPENAI_API_KEY = 'openai-key';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
      await expect(new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'mèo'))
        .rejects.toMatchObject({ response: { code: 'OPENAI_IMAGE_FAILED', provider_status: 400 } });
    });
  });

  describe('summarizeTitle', () => {
    it('lấy tiêu đề từ model chữ và dọn ngoặc, dấu chấm', async () => {
      process.env.AI_MOCK = 'false';
      process.env.GEMINI_API_KEY = 'gemini-key';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: '"Robot Mindo 3D".' }] } }] }),
      }));

      await expect(new AiProviderService().summarizeTitle('Tạo robot trợ lý 3D thân thiện')).resolves.toBe('Robot Mindo 3D');
    });

    it('cả hai nhà đều hỏng thì trả null, KHÔNG ném', async () => {
      /* Tiêu đề là bước phụ — ném ra ở đây là đánh sập cả tấm ảnh đã tạo xong */
      process.env.AI_MOCK = 'false';
      process.env.GEMINI_API_KEY = 'gemini-key';
      process.env.DEEPSEEK_API_KEY = 'ds-key';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

      await expect(new AiProviderService().summarizeTitle('mèo')).resolves.toBeNull();
    });

    it('chế độ mock không gọi mạng', async () => {
      delete process.env.AI_MOCK;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(new AiProviderService().summarizeTitle('mèo')).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
