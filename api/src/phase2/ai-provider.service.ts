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
type AiResult = { content: string; attachmentUrl?: string; metadata?: Record<string, unknown> };
type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'auto' } }
  | { type: 'file'; file: { filename: string; file_data: string } };

@Injectable()
export class AiProviderService {
  async generate(expert: AiExpert, kind: AiMessageKind, input: string, options: AiGenerateOptions = {}): Promise<AiResult> {
    const startedAt = Date.now();
    if (process.env.AI_MOCK !== 'false') return this.mock(expert, kind, input, options, startedAt);
    const apiKey = process.env.AI_API_KEY?.trim();
    const baseUrl = (process.env.AI_API_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    if (!apiKey) throw new ServiceUnavailableException('Chưa cấu hình nhà cung cấp AI');

    if (kind === AiMessageKind.IMAGE) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/images/generations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: process.env.AI_IMAGE_MODEL ?? 'gpt-image-1', prompt: input, size: '1024x1024' }),
          signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 60_000)),
        });
      } catch {
        throw new ServiceUnavailableException('Không thể kết nối nhà cung cấp AI');
      }
      if (!response.ok) throw this.providerError(response.status, 'Nhà cung cấp AI chưa thể tạo ảnh');
      const data = await response.json() as {
        data?: Array<{ url?: string; b64_json?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
      };
      const item = data.data?.[0];
      const attachmentUrl = item?.url ?? (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : undefined);
      if (!attachmentUrl) throw new ServiceUnavailableException('Nhà cung cấp AI không trả về ảnh');
      return {
        content: 'Ảnh đã được tạo theo yêu cầu.',
        attachmentUrl,
        metadata: this.metadata(process.env.AI_IMAGE_MODEL ?? 'gpt-image-1', data.usage, startedAt, { credits: 1, width: 1024, height: 1024 }),
      };
    }

    const taskInstruction = kind === AiMessageKind.TRANSLATION
      ? `Dịch nội dung từ ${options.sourceLanguage ?? 'ngôn ngữ tự động nhận diện'} sang ${options.targetLanguage ?? 'Tiếng Việt'}. Chỉ trả về bản dịch.`
      : kind === AiMessageKind.DOCUMENT
        ? 'Soạn tài liệu Markdown hoàn chỉnh, có tiêu đề và các mục rõ ràng.'
        : '';
    const history = (options.history ?? []).slice(-Number(process.env.AI_CONTEXT_MESSAGES ?? 20));
    const userContent = this.userContent(input, options.attachment);
    const model = process.env.AI_CHAT_MODEL ?? 'gpt-4o-mini';
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: `${expert.systemPrompt}\n${taskInstruction}`.trim() },
            ...history,
            { role: 'user', content: userContent },
          ],
        }),
        signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 60_000)),
      });
    } catch {
      throw new ServiceUnavailableException('Không thể kết nối nhà cung cấp AI');
    }
    if (!response.ok) throw this.providerError(response.status, 'Nhà cung cấp AI chưa thể trả lời');
    const data = await response.json() as {
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new ServiceUnavailableException('Nhà cung cấp AI trả về nội dung trống');
    const specific = kind === AiMessageKind.DOCUMENT
      ? { filename: 'tai-lieu-mindo.md', mime_type: 'text/markdown', size: Buffer.byteLength(content), credits: 1 }
      : kind === AiMessageKind.TRANSLATION
        ? { source_language: options.sourceLanguage ?? 'auto', target_language: options.targetLanguage, character_count: input.length, credits: 1 }
        : {};
    return { content, metadata: this.metadata(data.model ?? model, data.usage, startedAt, specific) };
  }

  private userContent(input: string, attachment?: AiInputFile): string | ChatContentPart[] {
    if (!attachment) return input;
    const dataUrl = `data:${attachment.mimeType};base64,${attachment.content.toString('base64')}`;
    if (attachment.mimeType.startsWith('image/')) {
      return [
        { type: 'text', text: input },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } },
      ];
    }
    return [
      { type: 'file', file: { filename: attachment.name, file_data: dataUrl } },
      { type: 'text', text: input },
    ];
  }

  private metadata(
    model: string,
    usage: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number; total_tokens?: number } | undefined,
    startedAt: number,
    extra: Record<string, unknown>,
  ) {
    const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
    return {
      ...extra,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: usage?.total_tokens ?? inputTokens + outputTokens,
      duration_ms: Date.now() - startedAt,
    };
  }

  private providerError(status: number, message: string) {
    return new ServiceUnavailableException({ message, code: 'AI_PROVIDER_ERROR', provider_status: status });
  }

  private mock(expert: AiExpert, kind: AiMessageKind, input: string, options: AiGenerateOptions, startedAt: number): AiResult {
    const common = { model: 'mindo-local-mock', credits: 1, input_tokens: 0, output_tokens: 0, total_tokens: 0, duration_ms: Date.now() - startedAt };
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
