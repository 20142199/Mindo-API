import { Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import {
  isPrivateAddress,
  LinkPreview,
  MAX_PREVIEW_BYTES,
  normalizePreviewUrl,
  parseLinkPreview,
  PREVIEW_TIMEOUT_MS,
} from './chat.link-preview';

const USER_AGENT = 'MindoBot/1.0 (+https://mindo.vn)';
/** Chuyển hướng quá số này thì bỏ — vòng lặp chuyển hướng là cách làm treo server */
const MAX_REDIRECTS = 3;
/** Giữ kết quả một lúc: người dùng gõ tiếp thì app hỏi lại chính link đó */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

@Injectable()
export class ChatLinkPreviewService {
  private readonly logger = new Logger(ChatLinkPreviewService.name);
  private readonly cache = new Map<string, { at: number; value: LinkPreview | null }>();

  /**
   * Đọc thẻ xem trước của một link, `null` nếu không đọc được.
   *
   * KHÔNG BAO GIỜ NÉM. Người dùng dán một link chết, một trang chặn bot, hay
   * một tên miền không tồn tại — chuyện thường ngày, và không có lý do gì để
   * vì thế mà không gửi được tin. Không đọc được thì tin nhắn đi như chữ
   * thường.
   */
  async fetchPreview(rawUrl: string): Promise<LinkPreview | null> {
    const url = normalizePreviewUrl(rawUrl);
    if (!url) return null;

    const key = url.toString();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    let preview: LinkPreview | null = null;
    try {
      preview = await this.load(url);
    } catch (error) {
      this.logger.debug(`Không đọc được xem trước của ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.remember(key, preview);
    return preview;
  }

  private remember(key: string, value: LinkPreview | null) {
    /* Bản đồ giữ thứ tự chèn, nên phần tử đầu là cái cũ nhất. */
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), value });
  }

  /**
   * Tên miền phải trỏ ra ngoài Internet THẬT.
   *
   * `normalizePreviewUrl` mới chặn được thứ lộ ngay trên mặt chữ. Nhưng
   * `evil.com` hoàn toàn có thể trỏ A record về 127.0.0.1 — gọi là DNS
   * rebinding, và đó là cách phổ biến nhất để đi vòng qua một bộ lọc chỉ
   * đọc tên miền. Nên phải tra ra địa chỉ thật rồi mới quyết.
   */
  private async assertPublicHost(hostname: string) {
    const records = await lookup(hostname, { all: true });
    if (!records.length) throw new Error('Không phân giải được tên miền');
    const blocked = records.find((record) => isPrivateAddress(record.address));
    if (blocked) throw new Error(`Tên miền trỏ vào mạng nội bộ (${blocked.address})`);
  }

  /**
   * Tự đi theo chuyển hướng thay vì để `fetch` lo.
   *
   * Vì mỗi chặng phải kiểm lại: một trang công khai có quyền chuyển hướng
   * sang `http://169.254.169.254`, và `redirect: 'follow'` sẽ ngoan ngoãn đi
   * theo mà không hỏi ai.
   */
  private async load(start: URL): Promise<LinkPreview | null> {
    let url = start;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await this.assertPublicHost(url.hostname);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'user-agent': USER_AGENT,
            accept: 'text/html,application/xhtml+xml;q=0.9',
            'accept-language': 'vi,en;q=0.8',
          },
        });
      } finally {
        clearTimeout(timer);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return null;
        const next = normalizePreviewUrl(new URL(location, url).toString());
        if (!next) return null;
        url = next;
        continue;
      }

      if (!response.ok) return null;
      /* Chỉ đọc HTML. Trỏ vào một tệp video 2GB thì `text()` nuốt sạch bộ nhớ. */
      const type = response.headers.get('content-type') ?? '';
      if (!type.includes('html')) return null;
      if (Number(response.headers.get('content-length') ?? 0) > MAX_PREVIEW_BYTES) return null;

      const html = await this.readCapped(response);
      return parseLinkPreview(html, url.toString());
    }

    return null;
  }

  /**
   * Đọc tối đa `MAX_PREVIEW_BYTES` rồi CẮT NGANG.
   *
   * `content-length` là thứ máy chủ tự khai, và khi dùng chunked encoding thì
   * nó vắng mặt hẳn — tin vào nó là để ngỏ cho một trang trả về dòng dữ liệu
   * vô tận. Thẻ `<head>` nằm ở đầu nên cắt nửa chừng vẫn đủ bóc metadata.
   */
  private async readCapped(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return response.text();

    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      size += value.length;
      if (size >= MAX_PREVIEW_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}
