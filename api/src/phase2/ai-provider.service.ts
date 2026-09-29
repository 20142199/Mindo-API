import { randomInt } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AiExpert, AiMessageKind } from '@prisma/client';
import { AiAspectRatio, AiImageStyle, aspectRatioOf, imageDimensions, imageStyleOf, sanitizeTitle, styledPrompt } from './ai-image.options';

export type AiContextMessage = { role: 'user' | 'assistant'; content: string };
export type AiInputFile = { name: string; mimeType: string; content: Buffer };
export type AiGenerateOptions = {
  sourceLanguage?: string;
  targetLanguage?: string;
  history?: AiContextMessage[];
  attachment?: AiInputFile;
  signal?: AbortSignal;
  onDelta?: (content: string) => Promise<void>;
  /* Chỉ dùng cho IMAGE — xem ai-image.options.ts */
  imageStyle?: AiImageStyle;
  aspectRatio?: AiAspectRatio;
};
type AiVendor = 'gemini' | 'deepseek' | 'openai' | 'pollinations';
/* Nhà cung cấp chữ — nhận ở LLM_PRIMARY_VENDOR / LLM_FALLBACK_VENDOR */
type TextVendor = 'gemini' | 'deepseek' | 'openai';
/* Nhà cung cấp ảnh — tách khỏi `AiVendor` vì không phải nhà nào cũng làm chữ */
type ImageVendor = 'gemini' | 'openai' | 'pollinations';
type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number };
type AiResult = {
  content: string;
  attachmentData?: { content: Buffer; mimeType: string; filename: string };
  metadata?: Record<string, unknown>;
};
type ProviderTextResult = { content: string; vendor: AiVendor; model: string; usage: TokenUsage };

class VendorError extends Error {
  constructor(public readonly vendor: AiVendor, public readonly status: number | null, message: string) { super(message); }
}

/* Ba kích thước gpt-image-1 nhận — xem generateOpenAiImage */
const OPENAI_IMAGE_SIZES: Record<AiAspectRatio, string> = {
  '1:1': '1024x1024',
  '4:3': '1536x1024',
  '9:16': '1024x1536',
};

@Injectable()
export class AiProviderService {
  async generate(expert: AiExpert, kind: AiMessageKind, input: string, options: AiGenerateOptions = {}): Promise<AiResult> {
    const startedAt = Date.now();
    if (process.env.AI_MOCK !== 'false') {
      const result = this.mock(expert, kind, input, options, startedAt);
      if (kind !== AiMessageKind.IMAGE) await options.onDelta?.(result.content);
      return result;
    }
    if (kind === AiMessageKind.IMAGE) return this.generateImage(input, startedAt, options);

    const taskInstruction = kind === AiMessageKind.TRANSLATION
      ? `Dịch nội dung từ ${options.sourceLanguage ?? 'ngôn ngữ tự động nhận diện'} sang ${options.targetLanguage ?? 'Tiếng Việt'}. Chỉ trả về bản dịch.`
      : kind === AiMessageKind.DOCUMENT
        ? 'Soạn tài liệu Markdown hoàn chỉnh, có tiêu đề và các mục rõ ràng.'
        : '';
    const systemPrompt = `${expert.systemPrompt}\n${taskInstruction}`.trim();
    /*
      A translation is a one-shot request. With the session history attached
      the model translates the earlier turns too — on staging a Vietnamese →
      Korean request came back with the previous inputs translated above the
      requested text.
    */
    if (kind === AiMessageKind.TRANSLATION) options = { ...options, history: [] };
    const primary = this.vendor(process.env.LLM_PRIMARY_VENDOR, 'gemini');
    const fallback = this.vendor(process.env.LLM_FALLBACK_VENDOR, 'deepseek');
    const providers = [...new Set<TextVendor>([primary, fallback])];
    let lastError: VendorError | undefined;

    for (const vendor of providers) {
      try {
        const generated = await this.completeText(vendor, systemPrompt, input, options);
        const specific = kind === AiMessageKind.DOCUMENT
          ? { filename: 'tai-lieu-mindo.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', credits: 1 }
          : kind === AiMessageKind.TRANSLATION
            ? { source_language: options.sourceLanguage ?? 'auto', target_language: options.targetLanguage, character_count: input.length, credits: 1 }
            : { credits: 1 };
        return {
          content: generated.content,
          metadata: {
            ...specific,
            vendor: generated.vendor,
            model: generated.model,
            input_tokens: generated.usage.inputTokens,
            output_tokens: generated.usage.outputTokens,
            total_tokens: generated.usage.totalTokens,
            duration_ms: Date.now() - startedAt,
            primary_vendor: primary,
            fallback_used: generated.vendor !== primary,
          },
        };
      } catch (error) {
        if (options.signal?.aborted) throw error;
        lastError = error instanceof VendorError ? error : new VendorError(vendor, null, error instanceof Error ? error.message : 'Unknown provider error');
        // DeepSeek không được phép nhận một lượt có file rồi giả vờ xử lý text-only.
        if (options.attachment) break;
      }
    }

    throw new ServiceUnavailableException({
      message: 'Các nhà cung cấp AI hiện chưa thể trả lời',
      code: 'LLM_BOTH_DOWN',
      last_vendor: lastError?.vendor,
      provider_status: lastError?.status,
    });
  }

  /**
   * Tóm mô tả ảnh thành tiêu đề 2–5 chữ.
   *
   * Không bao giờ ném: mọi đường hỏng trả `null`, người gọi lùi về mô tả cắt
   * ngắn đang có. Đi đúng thứ tự nhà cung cấp chữ như `generate`.
   */
  async summarizeTitle(prompt: string, signal?: AbortSignal): Promise<string | null> {
    if (process.env.AI_MOCK !== 'false') return null;
    const systemPrompt = 'Đặt tiêu đề ngắn từ 2 đến 5 chữ cho bức ảnh được mô tả. Giữ ngôn ngữ của mô tả. Chỉ trả về tiêu đề, không ngoặc kép, không dấu chấm.';
    const primary = this.vendor(process.env.LLM_PRIMARY_VENDOR, 'gemini');
    const fallback = this.vendor(process.env.LLM_FALLBACK_VENDOR, 'deepseek');
    for (const vendor of [...new Set<TextVendor>([primary, fallback])]) {
      try {
        const result = await this.completeText(vendor, systemPrompt, prompt, { signal });
        return sanitizeTitle(result.content);
      } catch {
        if (signal?.aborted) return null;
      }
    }
    return null;
  }

  private async completeGemini(systemPrompt: string, input: string, options: AiGenerateOptions): Promise<ProviderTextResult> {
    const vendor: AiVendor = 'gemini';
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new VendorError(vendor, null, 'Missing Gemini API key');
    const baseUrl = (process.env.GEMINI_NATIVE_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const model = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
    const history = (options.history ?? []).slice(-this.contextLimit());
    const parts: Array<Record<string, unknown>> = [];
    if (options.attachment) {
      parts.push({
        inline_data: {
          mime_type: options.attachment.mimeType,
          data: options.attachment.content.toString('base64'),
        },
      });
    }
    parts.push({ text: input });
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [
        ...history.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
        { role: 'user', parts },
      ],
      generationConfig: {
        temperature: Number(process.env.AI_TEMPERATURE ?? 0.4),
        maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 2_048),
      },
    };
    const response = await this.request(vendor, `${baseUrl}/models/${model}:${options.onDelta ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    }, body, options.signal);
    if (options.onDelta) return this.readGeminiStream(response, vendor, model, options.onDelta);
    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
    };
    const content = (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('').trim();
    if (!content) throw new VendorError(vendor, response.status, `Gemini empty response (${data.candidates?.[0]?.finishReason ?? 'unknown'})`);
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0);
    return {
      content,
      vendor,
      model,
      usage: { inputTokens, outputTokens, totalTokens: data.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens },
    };
  }

  private completeText(vendor: TextVendor, systemPrompt: string, input: string, options: AiGenerateOptions): Promise<ProviderTextResult> {
    if (vendor === 'gemini') return this.completeGemini(systemPrompt, input, options);
    if (vendor === 'openai') return this.completeOpenAi(systemPrompt, input, options);
    return this.completeDeepSeek(systemPrompt, input, options);
  }

  private completeDeepSeek(systemPrompt: string, input: string, options: AiGenerateOptions): Promise<ProviderTextResult> {
    const vendor: AiVendor = 'deepseek';
    if (options.attachment) throw new VendorError(vendor, null, 'DeepSeek fallback does not support Mindo file attachments');
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) throw new VendorError(vendor, null, 'Missing DeepSeek API key');
    return this.completeChatCompletions(vendor, {
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      apiKey,
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      /* DeepSeek chưa nhận `max_completion_tokens` */
      maxTokensField: 'max_tokens',
    }, systemPrompt, input, options);
  }

  /**
   * OpenAI qua Chat Completions — cùng giao thức với DeepSeek nên dùng chung
   * `completeChatCompletions`, chỉ khác ba chỗ:
   *
   * - nhận file đính kèm: ảnh gửi dạng `image_url`, PDF dạng `file` (DeepSeek
   *   thì không nhận gì);
   * - giới hạn độ dài gửi bằng `max_completion_tokens` — OpenAI đã bỏ
   *   `max_tokens` ở các model mới và trả 400 nếu còn gửi;
   * - họ model suy luận (gpt-5*, o1/o3/o4…) chỉ chấp nhận temperature mặc
   *   định, gửi số khác là 400 — nên không gửi.
   */
  private completeOpenAi(systemPrompt: string, input: string, options: AiGenerateOptions): Promise<ProviderTextResult> {
    const vendor: AiVendor = 'openai';
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new VendorError(vendor, null, 'Missing OpenAI API key');
    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';
    const attachment = options.attachment;
    let userContent: string | Array<Record<string, unknown>> = input;
    if (attachment) {
      const dataUrl = `data:${attachment.mimeType};base64,${attachment.content.toString('base64')}`;
      if (attachment.mimeType.startsWith('image/')) {
        userContent = [{ type: 'image_url', image_url: { url: dataUrl } }, { type: 'text', text: input }];
      } else if (attachment.mimeType === 'application/pdf') {
        userContent = [{ type: 'file', file: { filename: attachment.name, file_data: dataUrl } }, { type: 'text', text: input }];
      } else {
        throw new VendorError(vendor, null, `OpenAI does not accept ${attachment.mimeType} attachments`);
      }
    }
    return this.completeChatCompletions(vendor, {
      baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      apiKey,
      model,
      maxTokensField: 'max_completion_tokens',
      omitTemperature: /^(gpt-5|o\d)/.test(model),
      userContent,
    }, systemPrompt, input, options);
  }

  private async completeChatCompletions(
    vendor: AiVendor,
    config: {
      baseUrl: string;
      apiKey: string;
      model: string;
      maxTokensField: 'max_tokens' | 'max_completion_tokens';
      omitTemperature?: boolean;
      userContent?: string | Array<Record<string, unknown>>;
    },
    systemPrompt: string,
    input: string,
    options: AiGenerateOptions,
  ): Promise<ProviderTextResult> {
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const model = config.model;
    const history = (options.history ?? []).slice(-this.contextLimit());
    const response = await this.request(vendor, `${baseUrl}/chat/completions`, {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    }, {
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: config.userContent ?? input }],
      ...(config.omitTemperature ? {} : { temperature: Number(process.env.AI_TEMPERATURE ?? 0.4) }),
      [config.maxTokensField]: Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 2_048),
      ...(options.onDelta ? { stream: true, stream_options: { include_usage: true } } : {}),
    }, options.signal);
    const label = vendor === 'openai' ? 'OpenAI' : 'DeepSeek';
    if (options.onDelta) return this.readChatCompletionsStream(response, vendor, model, label, options.onDelta);
    const data = await response.json() as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new VendorError(vendor, response.status, `${label} empty response`);
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    return {
      content,
      vendor,
      model: data.model ?? model,
      usage: { inputTokens, outputTokens, totalTokens: data.usage?.total_tokens ?? inputTokens + outputTokens },
    };
  }

  /**
   * Chọn nhà tạo ảnh.
   *
   * Tách hẳn khỏi `LLM_PRIMARY_VENDOR` vì chữ và ảnh không nhất thiết mua của
   * cùng một nhà — và thực tế đang đúng như vậy: key Gemini hiện tại gọi model
   * chat thì 200, gọi model ảnh thì 429 kèm `limit: 0`, tức bậc miễn phí không
   * cấp suất tạo ảnh nào. Ép hai thứ đi chung một biến thì muốn đổi ảnh phải
   * hi sinh cả phần chữ đang chạy tốt.
   *
   * Mặc định vẫn là `gemini`: đổi hành vi sau lưng người đang chạy là cách
   * nhanh nhất để một môi trường im lặng dùng nhà khác mà không ai hay.
   */
  private imageVendor(): ImageVendor {
    const value = process.env.IMAGE_VENDOR?.trim().toLowerCase();
    return value === 'pollinations' || value === 'openai' ? value : 'gemini';
  }

  private generateImage(input: string, startedAt: number, options: AiGenerateOptions): Promise<AiResult> {
    const ratio = aspectRatioOf(options.aspectRatio);
    /* Phong cách ghép vào mô tả ở ĐÂY, một chỗ cho mọi nhà cung cấp */
    const prompt = styledPrompt(input, imageStyleOf(options.imageStyle));
    const vendor = this.imageVendor();
    if (vendor === 'openai') return this.generateOpenAiImage(prompt, ratio, startedAt, options.signal);
    return vendor === 'pollinations'
      ? this.generatePollinationsImage(prompt, ratio, startedAt, options.signal)
      : this.generateGeminiImage(prompt, ratio, startedAt, options.signal);
  }

  /**
   * Tạo ảnh qua OpenAI Images API (`gpt-image-1`).
   *
   * Model này chỉ nhận ba kích thước, nên tỷ lệ của app được ánh xạ về cái
   * gần nhất: 4:3 → 1536×1024 (3:2), 9:16 → 1024×1536 (2:3). App vẽ ảnh với
   * `resizeMode="cover"` trong khung đúng tỷ lệ đã chọn, nên chỉ cắt đi một
   * dải mép chứ không méo. Kích thước thật được ghi vào metadata.
   *
   * Xin JPEG thay vì PNG mặc định: cùng một tấm 1024², PNG ~1,1 MB còn JPEG
   * chỉ bằng một phần — đỡ cho cả ổ đĩa server lẫn lúc app tải về.
   */
  private async generateOpenAiImage(input: string, ratio: AiAspectRatio, startedAt: number, signal?: AbortSignal): Promise<AiResult> {
    const vendor: AiVendor = 'openai';
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new ServiceUnavailableException({ message: 'Chưa cấu hình OpenAI để tạo ảnh', code: 'OPENAI_NOT_CONFIGURED' });
    const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-1';
    const quality = process.env.OPENAI_IMAGE_QUALITY?.trim() || 'medium';
    const size = OPENAI_IMAGE_SIZES[ratio];
    let response: Response;
    try {
      response = await this.request(vendor, `${baseUrl}/images/generations`, {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      }, { model, prompt: input, size, quality, n: 1, output_format: 'jpeg' }, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const status = error instanceof VendorError ? error.status : null;
      throw new ServiceUnavailableException({ message: 'OpenAI chưa thể tạo ảnh', code: 'OPENAI_IMAGE_FAILED', provider_status: status });
    }
    const data = await response.json() as {
      data?: Array<{ b64_json?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    };
    const bytes = data.data?.[0]?.b64_json;
    if (!bytes) throw new ServiceUnavailableException({ message: 'OpenAI không trả về ảnh', code: 'OPENAI_IMAGE_EMPTY' });
    const [width, height] = size.split('x').map(Number);
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    return {
      content: 'Ảnh đã được tạo theo yêu cầu.',
      attachmentData: { content: Buffer.from(bytes, 'base64'), mimeType: 'image/jpeg', filename: `mindo-ai-${Date.now()}.jpg` },
      metadata: {
        vendor,
        model,
        credits: 1,
        width,
        height,
        quality,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: data.usage?.total_tokens ?? inputTokens + outputTokens,
        duration_ms: Date.now() - startedAt,
        fallback_used: false,
      },
    };
  }

  /**
   * Tạo ảnh qua Pollinations — nhà DUY NHẤT không cần API key.
   *
   * Có mặt ở đây để luồng tạo ảnh chạy được từ app xuống tận nơi trong lúc
   * chưa ai cấp key. Đừng nhầm nó là lựa chọn cho bản chạy thật: đây là dịch
   * vụ công cộng miễn phí, không cam kết tốc độ cũng không cam kết còn sống.
   *
   * Khác mọi nhà còn lại ở hai điểm, nên không dùng lại `request()` được:
   * GET chứ không POST-JSON, và trả về THẲNG byte ảnh chứ không phải JSON.
   *
   * Mô tả nằm trong PATH chứ không phải query, nên bắt buộc
   * `encodeURIComponent`: một dấu `?` người dùng gõ mà không escape là toàn bộ
   * phần sau bị đọc thành tham số.
   */
  private async generatePollinationsImage(input: string, ratio: AiAspectRatio, startedAt: number, signal?: AbortSignal): Promise<AiResult> {
    const vendor: AiVendor = 'pollinations';
    const { width, height } = imageDimensions(ratio);
    /* Không có seed thì Pollinations trả đúng tấm cũ cho cùng mô tả — "Tạo lại" vô nghĩa */
    const seed = randomInt(1, 2_147_483_647);
    const baseUrl = (process.env.POLLINATIONS_BASE_URL ?? 'https://image.pollinations.ai').replace(/\/+$/, '');
    const model = process.env.POLLINATIONS_MODEL ?? 'flux';
    const url = `${baseUrl}/prompt/${encodeURIComponent(input)}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=${encodeURIComponent(model)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 60_000))])
          : AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 60_000)),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ServiceUnavailableException({ message: 'Chưa tạo được ảnh', code: 'POLLINATIONS_IMAGE_FAILED', provider_status: null });
    }
    if (!response.ok) {
      throw new ServiceUnavailableException({ message: 'Chưa tạo được ảnh', code: 'POLLINATIONS_IMAGE_FAILED', provider_status: response.status });
    }

    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
    const content = Buffer.from(await response.arrayBuffer());
    /* Thân rỗng vẫn là 200 bên Pollinations lúc quá tải — bắt ở đây, kẻo tin
       nhắn về tới app mang một tệp 0 byte và không ai biết vì sao */
    if (!content.length) {
      throw new ServiceUnavailableException({ message: 'Chưa tạo được ảnh', code: 'POLLINATIONS_IMAGE_EMPTY' });
    }

    return {
      content: 'Ảnh đã được tạo theo yêu cầu.',
      attachmentData: { content, mimeType, filename: `mindo-ai-${Date.now()}.${this.imageExtension(mimeType)}` },
      metadata: {
        vendor,
        model,
        credits: 1,
        width,
        height,
        seed,
        latency_ms: Date.now() - startedAt,
      },
    };
  }

  private async generateGeminiImage(input: string, ratio: AiAspectRatio, startedAt: number, signal?: AbortSignal): Promise<AiResult> {
    const vendor: AiVendor = 'gemini';
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new ServiceUnavailableException({ message: 'Chưa cấu hình Gemini để tạo ảnh', code: 'GEMINI_NOT_CONFIGURED' });
    const baseUrl = (process.env.GEMINI_NATIVE_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-lite-image';
    let response: Response;
    try {
      response = await this.request(vendor, `${baseUrl}/models/${model}:generateContent`, {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      }, {
        contents: [{ role: 'user', parts: [{ text: input }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio } },
      }, signal);
    } catch (error) {
      const status = error instanceof VendorError ? error.status : null;
      throw new ServiceUnavailableException({ message: 'Gemini chưa thể tạo ảnh', code: 'GEMINI_IMAGE_FAILED', provider_status: status });
    }
    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }> }; finishReason?: string }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const image = parts.find((part) => part.inlineData?.data || part.inline_data?.data);
    const bytes = image?.inlineData?.data ?? image?.inline_data?.data;
    const mimeType = image?.inlineData?.mimeType ?? image?.inline_data?.mime_type ?? 'image/png';
    if (!bytes) throw new ServiceUnavailableException({ message: 'Gemini không trả về ảnh', code: 'GEMINI_IMAGE_EMPTY' });
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0);
    return {
      content: 'Ảnh đã được tạo theo yêu cầu.',
      attachmentData: {
        content: Buffer.from(bytes, 'base64'),
        mimeType,
        filename: `mindo-ai-${Date.now()}.${this.imageExtension(mimeType)}`,
      },
      metadata: {
        vendor,
        model,
        credits: 1,
        ...imageDimensions(ratio),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: data.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
        duration_ms: Date.now() - startedAt,
        fallback_used: false,
      },
    };
  }

  private async request(vendor: AiVendor, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 60_000))])
          : AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 60_000)),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new VendorError(vendor, null, `${vendor} connection failed`);
    }
    if (!response.ok) throw new VendorError(vendor, response.status, `${vendor} HTTP ${response.status}`);
    return response;
  }

  private vendor(value: string | undefined, fallback: TextVendor): TextVendor {
    const clean = value?.trim().toLowerCase();
    return clean === 'gemini' || clean === 'deepseek' || clean === 'openai' ? clean : fallback;
  }

  private contextLimit() {
    const value = Number(process.env.AI_CONTEXT_MESSAGES ?? 20);
    return Number.isInteger(value) && value > 0 ? Math.min(value, 100) : 20;
  }

  private async readGeminiStream(
    response: Response,
    vendor: AiVendor,
    model: string,
    onDelta: (content: string) => Promise<void>,
  ): Promise<ProviderTextResult> {
    let content = '';
    let finishReason = 'unknown';
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    await this.readSse(response, async (payload) => {
      const data = JSON.parse(payload) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
      };
      const chunk = (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
      finishReason = data.candidates?.[0]?.finishReason ?? finishReason;
      inputTokens = data.usageMetadata?.promptTokenCount ?? inputTokens;
      outputTokens = data.usageMetadata
        ? (data.usageMetadata.candidatesTokenCount ?? 0) + (data.usageMetadata.thoughtsTokenCount ?? 0)
        : outputTokens;
      totalTokens = data.usageMetadata?.totalTokenCount ?? totalTokens;
      if (chunk) {
        content += chunk;
        await onDelta(content);
      }
    });
    content = content.trim();
    if (!content) throw new VendorError(vendor, response.status, `Gemini empty response (${finishReason})`);
    return { content, vendor, model, usage: { inputTokens, outputTokens, totalTokens: totalTokens || inputTokens + outputTokens } };
  }

  private async readChatCompletionsStream(
    response: Response,
    vendor: AiVendor,
    fallbackModel: string,
    label: string,
    onDelta: (content: string) => Promise<void>,
  ): Promise<ProviderTextResult> {
    let content = '';
    let model = fallbackModel;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    await this.readSse(response, async (payload) => {
      if (payload === '[DONE]') return;
      const data = JSON.parse(payload) as {
        model?: string;
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      model = data.model ?? model;
      inputTokens = data.usage?.prompt_tokens ?? inputTokens;
      outputTokens = data.usage?.completion_tokens ?? outputTokens;
      totalTokens = data.usage?.total_tokens ?? totalTokens;
      const chunk = data.choices?.[0]?.delta?.content ?? '';
      if (chunk) {
        content += chunk;
        await onDelta(content);
      }
    });
    content = content.trim();
    if (!content) throw new VendorError(vendor, response.status, `${label} empty response`);
    return { content, vendor, model, usage: { inputTokens, outputTokens, totalTokens: totalTokens || inputTokens + outputTokens } };
  }

  private async readSse(response: Response, onData: (payload: string) => Promise<void>) {
    if (!response.body) throw new Error('AI provider returned an empty stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload) await onData(payload);
      }
      if (done) break;
    }
    const trailing = pending.trim();
    if (trailing.startsWith('data:')) await onData(trailing.slice(5).trim());
  }

  private imageExtension(mimeType: string) {
    if (mimeType === 'image/jpeg') return 'jpg';
    if (mimeType === 'image/webp') return 'webp';
    return 'png';
  }

  private mock(expert: AiExpert, kind: AiMessageKind, input: string, options: AiGenerateOptions, startedAt: number): AiResult {
    const common = { vendor: 'mock', model: 'mindo-local-mock', credits: 1, input_tokens: 0, output_tokens: 0, total_tokens: 0, duration_ms: Date.now() - startedAt, fallback_used: false };
    if (kind === AiMessageKind.IMAGE) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#e8f0fe"/><rect x="96" y="96" width="832" height="832" rx="48" fill="#174ea6"/><text x="512" y="475" text-anchor="middle" fill="white" font-family="Arial" font-size="76" font-weight="700">Mindo AI</text><text x="512" y="565" text-anchor="middle" fill="#dbe8ff" font-family="Arial" font-size="30">Bản xem trước cục bộ</text></svg>`;
      return {
        content: `Bản xem trước ảnh cho yêu cầu: ${input}`,
        attachmentData: { content: Buffer.from(svg), mimeType: 'image/svg+xml', filename: `mindo-ai-${Date.now()}.svg` },
        metadata: { ...common, width: 1024, height: 1024 },
      };
    }
    if (kind === AiMessageKind.DOCUMENT) {
      const content = `# Tài liệu Mindo\n\n## Yêu cầu\n${input}\n\n## Nội dung đề xuất\nĐây là bản tài liệu mẫu được tạo trong chế độ phát triển.`;
      return { content, metadata: { ...common, filename: 'tai-lieu-mindo.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } };
    }
    if (kind === AiMessageKind.TRANSLATION) {
      return { content: `[Bản dịch ${options.targetLanguage ?? 'Tiếng Việt'}] ${input}`, metadata: { ...common, source_language: options.sourceLanguage ?? 'auto', target_language: options.targetLanguage, character_count: input.length } };
    }
    return { content: `${expert.name}: Mình đã nhận câu hỏi “${input}”. Đây là phản hồi mẫu ở chế độ phát triển; khi cấu hình nhà cung cấp AI, nội dung sẽ được tạo theo chuyên môn ${expert.specialty}.`, metadata: common };
  }
}
