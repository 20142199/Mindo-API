import { load } from 'cheerio';

/**
 * Đọc thẻ `og:` của một trang để dựng thẻ xem trước cho link dán vào chat.
 *
 * Tách phần THUẦN (không mạng) ra đây để test được: chặn địa chỉ nội bộ và
 * bóc metadata là hai chỗ sai thì hậu quả nặng nhất, mà cả hai đều không cần
 * tới mạng để kiểm.
 *
 * KHÁC news crawler ở một điểm sống còn: crawler chỉ tải từ danh sách tên
 * miền cấu hình sẵn, còn ở đây NGƯỜI DÙNG dán link gì cũng được. Server sẽ
 * tự tay gửi request tới địa chỉ do người lạ cung cấp — đó đúng là định
 * nghĩa của SSRF. Nên phải chặn theo chiều ngược lại: cấm mọi thứ trỏ vào
 * trong nhà.
 */

export interface LinkPreview {
  url: string;
  title: string;
  description: string | null;
  image: string | null;
  site_name: string | null;
}

/** Trang nặng hơn mức này thì bỏ — thẻ `<head>` nằm ở đầu, không cần đọc hết */
export const MAX_PREVIEW_BYTES = 512 * 1024;
export const PREVIEW_TIMEOUT_MS = 6_000;

const TITLE_MAX = 200;
const DESC_MAX = 400;

/**
 * Địa chỉ này có trỏ vào mạng nội bộ không.
 *
 * Danh sách theo RFC1918 (10/8, 172.16/12, 192.168/16), loopback (127/8, ::1),
 * link-local (169.254/16 — gồm cả 169.254.169.254, cổng metadata của mọi nhà
 * cung cấp đám mây), CGNAT (100.64/10), và IPv6 riêng (fc00::/7, fe80::/10).
 *
 * `::ffff:10.0.0.1` là IPv4 khoác áo IPv6 — bỏ tiền tố rồi kiểm lại, nếu
 * không thì một địa chỉ nội bộ đi lọt chỉ bằng cách viết khác đi.
 */
export function isPrivateAddress(address: string): boolean {
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!value) return true;

  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);

  const v4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (value === '::' || value === '::1') return true;
  /* fc00::/7 là fc.. hoặc fd..; fe80::/10 là fe8/fe9/fea/feb.. */
  if (/^f[cd][0-9a-f]{0,2}:/.test(value)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(value)) return true;
  return false;
}

/** Tên miền tự nó đã lộ là nội bộ — chặn trước khi tốn một lượt tra DNS */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  /* Không có dấu chấm nghĩa là tên máy trong mạng LAN, không phải tên miền */
  if (!host.includes('.') && !host.includes(':')) return true;
  return isPrivateAddress(host);
}

/**
 * Chuẩn hoá link người dùng dán, hoặc `null` nếu không dùng được.
 *
 * Chỉ nhận http/https: `file://` đọc trộm được tệp của server, còn
 * `gopher://` hay `dict://` là đường kinh điển để biến SSRF thành lệnh gửi
 * tới Redis hay cơ sở dữ liệu ngay bên cạnh.
 */
export function normalizePreviewUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (isPrivateHostname(url.hostname)) return null;
  /* Thông tin đăng nhập nhúng trong link (`http://user:pass@host`) thường là
     mồi lừa server gửi kèm chứng thực đi nơi khác. */
  if (url.username || url.password) return null;
  return url;
}

/** Link ĐẦU TIÊN trong đoạn chữ — chat chỉ vẽ một thẻ, không vẽ hết */
export function firstUrlIn(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  return match ? match[0] : null;
}

const clean = (value: string | undefined, max: number): string | null => {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * Bóc metadata từ HTML. `null` khi trang không có nổi một cái tiêu đề —
 * thẻ xem trước chỉ có mỗi đường link thì thà để nguyên chữ còn hơn.
 *
 * `image` quy về đường dẫn tuyệt đối: rất nhiều trang khai `og:image` dạng
 * tương đối (`/img/cover.png`), mà app thì không biết lấy gốc ở đâu.
 */
export function parseLinkPreview(html: string, finalUrl: string): LinkPreview | null {
  const $ = load(html);
  const meta = (selector: string) => $(selector).attr('content');

  const title =
    clean(meta('meta[property="og:title"]'), TITLE_MAX) ??
    clean(meta('meta[name="twitter:title"]'), TITLE_MAX) ??
    clean($('title').first().text(), TITLE_MAX);
  if (!title) return null;

  const rawImage =
    meta('meta[property="og:image"]') ??
    meta('meta[property="og:image:url"]') ??
    meta('meta[name="twitter:image"]');

  let image: string | null = null;
  if (rawImage?.trim()) {
    try {
      const resolved = new URL(rawImage.trim(), finalUrl);
      /* Ảnh cũng phải công khai: một `og:image` trỏ vào 127.0.0.1 biến máy
         người dùng thành công cụ dò cổng trong mạng của chính họ. */
      if (
        (resolved.protocol === 'http:' || resolved.protocol === 'https:') &&
        !isPrivateHostname(resolved.hostname)
      ) {
        image = resolved.toString();
      }
    } catch {
      image = null;
    }
  }

  return {
    url: finalUrl,
    title,
    description:
      clean(meta('meta[property="og:description"]'), DESC_MAX) ??
      clean(meta('meta[name="twitter:description"]'), DESC_MAX) ??
      clean(meta('meta[name="description"]'), DESC_MAX),
    image,
    site_name:
      clean(meta('meta[property="og:site_name"]'), 80) ??
      clean(new URL(finalUrl).hostname.replace(/^www\./, ''), 80),
  };
}
