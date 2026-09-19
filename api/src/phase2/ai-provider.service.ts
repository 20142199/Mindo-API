import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AiExpert, AiMessageKind } from '@prisma/client';

type AiResult = { content: string; attachmentUrl?: string; metadata?: Record<string, unknown> };

@Injectable()
export class AiProviderService {
  async generate(expert: AiExpert, kind: AiMessageKind, input: string, targetLanguage?: string): Promise<AiResult> {
    if (process.env.AI_MOCK !== 'false') return this.mock(expert, kind, input, targetLanguage);
    const apiKey = process.env.AI_API_KEY;
    const baseUrl = (process.env.AI_API_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    if (!apiKey) throw new ServiceUnavailableException('Chưa cấu hình nhà cung cấp AI');
    if (kind === AiMessageKind.IMAGE) {
      const response = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: process.env.AI_IMAGE_MODEL ?? 'gpt-image-1', prompt: input, size: '1024x1024' }),
        signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 60_000)),
      });
      if (!response.ok) throw new ServiceUnavailableException('Nhà cung cấp AI chưa thể tạo ảnh');
      const data = await response.json() as { data?: Array<{ url?: string; b64_json?: string }> };
      const item = data.data?.[0];
      const attachmentUrl = item?.url ?? (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : undefined);
      if (!attachmentUrl) throw new ServiceUnavailableException('Nhà cung cấp AI không trả về ảnh');
      return { content: 'Ảnh đã được tạo theo yêu cầu.', attachmentUrl };
    }
    const taskInstruction = kind === AiMessageKind.TRANSLATION
      ? `Dịch nội dung sang ${targetLanguage ?? 'Tiếng Việt'}. Chỉ trả về bản dịch.`
      : kind === AiMessageKind.DOCUMENT
        ? 'Soạn tài liệu Markdown hoàn chỉnh, có tiêu đề và các mục rõ ràng.'
        : '';
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.AI_CHAT_MODEL ?? 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `${expert.systemPrompt}\n${taskInstruction}`.trim() },
          { role: 'user', content: input },
        ],
      }),
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 60_000)),
    });
    if (!response.ok) throw new ServiceUnavailableException('Nhà cung cấp AI chưa thể trả lời');
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new ServiceUnavailableException('Nhà cung cấp AI trả về nội dung trống');
    return { content, metadata: kind === AiMessageKind.DOCUMENT ? { filename: 'tai-lieu-mindo.md', mime_type: 'text/markdown' } : undefined };
  }

  private mock(expert: AiExpert, kind: AiMessageKind, input: string, targetLanguage?: string): AiResult {
    if (kind === AiMessageKind.IMAGE) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#e8f0fe"/><rect x="96" y="96" width="832" height="832" rx="48" fill="#174ea6"/><text x="512" y="475" text-anchor="middle" fill="white" font-family="Arial" font-size="76" font-weight="700">Mindo AI</text><text x="512" y="565" text-anchor="middle" fill="#dbe8ff" font-family="Arial" font-size="30">Bản xem trước cục bộ</text></svg>`;
      return { content: `Bản xem trước ảnh cho yêu cầu: ${input}`, attachmentUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
    }
    if (kind === AiMessageKind.DOCUMENT) {
      return { content: `# Tài liệu Mindo\n\n## Yêu cầu\n${input}\n\n## Nội dung đề xuất\nĐây là bản tài liệu mẫu được tạo trong chế độ phát triển.`, metadata: { filename: 'tai-lieu-mindo.md', mime_type: 'text/markdown' } };
    }
    if (kind === AiMessageKind.TRANSLATION) return { content: `[Bản dịch ${targetLanguage ?? 'Tiếng Việt'}] ${input}` };
    return { content: `${expert.name}: Mình đã nhận câu hỏi “${input}”. Đây là phản hồi mẫu ở chế độ phát triển; khi cấu hình nhà cung cấp AI, nội dung sẽ được tạo theo chuyên môn ${expert.specialty}.` };
  }
}
