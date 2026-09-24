import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AiExpert, AiMessageKind } from '@prisma/client';

export type AiContextMessage = { role: 'user' | 'assistant'; content: string };
export type AiInputFile = { name: string; mimeType: string; content: Buffer };
export type AiGenerateOptions = {
  sourceLanguage?: string;
  targetLanguage?: string;
  history?: AiContextMessage[];
  attachment?: AiInputFile;
};
type AiVendor = 'gemini' | 'deepseek';
type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number };
type AiResult = { content: string; attachmentUrl?: string; metadata?: Record<string, unknown> };
type ProviderTextResult = { content: string; vendor: AiVendor; model: string; usage: TokenUsage };

class VendorError extends Error {
  constructor(public readonly vendor: AiVendor, public readonly status: number | null, message: string) { super(message); }
}

@Injectable()
export class AiProviderService {
  async generate(expert: AiExpert, kind: AiMessageKind, input: string, options: AiGenerateOptions = {}): Promise<AiResult> {
    const startedAt = Date.now();
    if (process.env.AI_MOCK !== 'false') return this.mock(expert, kind, input, options, startedAt);
    if (kind === AiMessageKind.IMAGE) return this.generateGeminiImage(input, startedAt);

    const taskInstruction = kind === AiMessageKind.TRANSLATION
      ? `Dịch nội dung từ ${options.sourceLanguage ?? 'ngôn ngữ tự động nhận diện'} sang ${options.targetLanguage ?? 'Tiếng Việt'}. Chỉ trả về bản dịch.`
      : kind === AiMessageKind.DOCUMENT
        ? 'Soạn tài liệu Markdown hoàn chỉnh, có tiêu đề và các mục rõ ràng.'
        : '';
    const systemPrompt = `${expert.systemPrompt}\n${taskInstruction}`.trim();
    const primary = this.vendor(process.env.LLM_PRIMARY_VENDOR, 'gemini');
    const fallback = this.vendor(process.env.LLM_FALLBACK_VENDOR, 'deepseek');
    const providers = [...new Set<AiVendor>([primary, fallback])];
    let lastError: VendorError | undefined;

    for (const vendor of providers) {
      try {
        const generated = vendor === 'gemini'
          ? await this.completeGemini(systemPrompt, input, options)
          : await this.completeDeepSeek(systemPrompt, input, options);
        const specific = kind === AiMessageKind.DOCUMENT
          ? { filename: 'tai-lieu-mindo.md', mime_type: 'text/markdown', size: Buffer.byteLength(generated.content), credits: 1 }
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
    const response = await this.request(vendor, `${baseUrl}/models/${model}:generateContent`, {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    }, body);
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

  private async completeDeepSeek(systemPrompt: string, input: string, options: AiGenerateOptions): Promise<ProviderTextResult> {
    const vendor: AiVendor = 'deepseek';
    if (options.attachment) throw new VendorError(vendor, null, 'DeepSeek fallback does not support Mindo file attachments');
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) throw new VendorError(vendor, null, 'Missing DeepSeek API key');
    const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, '');
    const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
    const history = (options.history ?? []).slice(-this.contextLimit());
    const response = await this.request(vendor, `${baseUrl}/chat/completions`, {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    }, {
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: input }],
      temperature: Number(process.env.AI_TEMPERATURE ?? 0.4),
      max_tokens: Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 2_048),
    });
    const data = await response.json() as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new VendorError(vendor, response.status, 'DeepSeek empty response');
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    return {
      content,
      vendor,
      model: data.model ?? model,
      usage: { inputTokens, outputTokens, totalTokens: data.usage?.total_tokens ?? inputTokens + outputTokens },
    };
  }

  private async generateGeminiImage(input: string, startedAt: number): Promise<AiResult> {
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
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      });
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
      attachmentUrl: `data:${mimeType};base64,${bytes}`,
      metadata: {
        vendor,
        model,
        credits: 1,
        width: 1024,
        height: 1024,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: data.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
        duration_ms: Date.now() - startedAt,
        fallback_used: false,
      },
    };
  }

  private async request(vendor: AiVendor, url: string, headers: Record<string, string>, body: unknown) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 60_000)),
      });
    } catch {
      throw new VendorError(vendor, null, `${vendor} connection failed`);
    }
    if (!response.ok) throw new VendorError(vendor, response.status, `${vendor} HTTP ${response.status}`);
    return response;
  }

  private vendor(value: string | undefined, fallback: AiVendor): AiVendor {
    return value?.trim().toLowerCase() === 'deepseek' ? 'deepseek' : value?.trim().toLowerCase() === 'gemini' ? 'gemini' : fallback;
  }

  private contextLimit() {
    const value = Number(process.env.AI_CONTEXT_MESSAGES ?? 20);
    return Number.isInteger(value) && value > 0 ? Math.min(value, 100) : 20;
  }

  private mock(expert: AiExpert, kind: AiMessageKind, input: string, options: AiGenerateOptions, startedAt: number): AiResult {
    const common = { vendor: 'mock', model: 'mindo-local-mock', credits: 1, input_tokens: 0, output_tokens: 0, total_tokens: 0, duration_ms: Date.now() - startedAt, fallback_used: false };
    if (kind === AiMessageKind.IMAGE) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#e8f0fe"/><rect x="96" y="96" width="832" height="832" rx="48" fill="#174ea6"/><text x="512" y="475" text-anchor="middle" fill="white" font-family="Arial" font-size="76" font-weight="700">Mindo AI</text><text x="512" y="565" text-anchor="middle" fill="#dbe8ff" font-family="Arial" font-size="30">Bản xem trước cục bộ</text></svg>`;
      return { content: `Bản xem trước ảnh cho yêu cầu: ${input}`, attachmentUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, metadata: { ...common, width: 1024, height: 1024 } };
    }
    if (kind === AiMessageKind.DOCUMENT) {
      const content = `# Tài liệu Mindo\n\n## Yêu cầu\n${input}\n\n## Nội dung đề xuất\nĐây là bản tài liệu mẫu được tạo trong chế độ phát triển.`;
      return { content, metadata: { ...common, filename: 'tai-lieu-mindo.md', mime_type: 'text/markdown', size: Buffer.byteLength(content) } };
    }
    if (kind === AiMessageKind.TRANSLATION) {
      return { content: `[Bản dịch ${options.targetLanguage ?? 'Tiếng Việt'}] ${input}`, metadata: { ...common, source_language: options.sourceLanguage ?? 'auto', target_language: options.targetLanguage, character_count: input.length } };
    }
    return { content: `${expert.name}: Mình đã nhận câu hỏi “${input}”. Đây là phản hồi mẫu ở chế độ phát triển; khi cấu hình nhà cung cấp AI, nội dung sẽ được tạo theo chuyên môn ${expert.specialty}.`, metadata: common };
  }
}
