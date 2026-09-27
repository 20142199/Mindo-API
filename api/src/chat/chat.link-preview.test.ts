import { describe, expect, it } from 'vitest';
import {
  firstUrlIn,
  isPrivateAddress,
  isPrivateHostname,
  normalizePreviewUrl,
  parseLinkPreview,
} from './chat.link-preview';

/**
 * Thẻ xem trước cho link dán vào chat (2026-09-27).
 *
 * Khác news crawler ở một điểm sống còn: crawler chỉ tải từ danh sách tên
 * miền cấu hình sẵn, còn ở đây NGƯỜI DÙNG dán gì server tải nấy. Server tự
 * tay gửi request tới địa chỉ do người lạ cung cấp — đó đúng là SSRF.
 *
 * Kẻ tấn công chỉ cần nhắn cho mình một tin chứa link là bắt được server
 * gọi tới bất cứ đâu trong mạng nội bộ: Redis ở cổng 6380, Postgres ở 5433,
 * hay 169.254.169.254 — cổng metadata của nhà cung cấp đám mây, nơi trả ra
 * khoá truy cập của cả hệ thống.
 *
 * Nên phần chặn địa chỉ được khoá kỹ hơn phần bóc metadata.
 */

describe('chặn địa chỉ nội bộ', () => {
  it.each([
    ['10.0.0.1', 'RFC1918 /8'],
    ['172.16.0.1', 'RFC1918 /12 — mép dưới'],
    ['172.31.255.254', 'RFC1918 /12 — mép trên'],
    ['192.168.1.1', 'RFC1918 /16'],
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', 'địa chỉ rỗng'],
    ['169.254.169.254', 'metadata đám mây'],
    ['100.64.0.1', 'CGNAT'],
    ['::1', 'loopback IPv6'],
    ['fd00::1', 'IPv6 riêng'],
    ['fe80::1', 'IPv6 link-local'],
  ])('%s bị chặn (%s)', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  /* `::ffff:10.0.0.1` là IPv4 khoác áo IPv6. Quên bóc tiền tố thì một địa
     chỉ nội bộ đi lọt chỉ bằng cách viết khác đi. */
  it('IPv4 khoác áo IPv6 cũng bị chặn', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:192.168.0.5')).toBe(true);
  });

  it.each([['8.8.8.8'], ['1.1.1.1'], ['172.32.0.1'], ['192.169.0.1']])(
    '%s là địa chỉ công khai, cho qua',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  /* `172.32` và `192.169` nằm NGAY NGOÀI dải riêng — chặn nhầm chúng là
     chặn nhầm cả một khoảng Internet thật. */
  it('không chặn lố sang dải công khai kề bên', () => {
    expect(isPrivateAddress('172.15.0.1')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
  });
});

describe('chặn tên miền nội bộ', () => {
  it.each([
    ['localhost'],
    ['app.localhost'],
    ['printer.local'],
    ['vault.internal'],
    ['redis'],
  ])('%s bị chặn', (host) => {
    expect(isPrivateHostname(host)).toBe(true);
  });

  /* Tên máy trong docker-compose không có dấu chấm — `redis`, `postgres`,
     `api`. Đó chính là thứ nguy hiểm nhất trên máy chủ chạy container. */
  it('tên không có dấu chấm là tên máy nội bộ', () => {
    expect(isPrivateHostname('postgres')).toBe(true);
    expect(isPrivateHostname('mindo-api')).toBe(true);
  });

  it('tên miền thật thì cho qua', () => {
    expect(isPrivateHostname('mindo.vn')).toBe(false);
    expect(isPrivateHostname('www.google.com')).toBe(false);
  });
});

describe('chuẩn hoá link', () => {
  it('nhận http và https', () => {
    expect(normalizePreviewUrl('https://mindo.vn/tin')?.hostname).toBe('mindo.vn');
    expect(normalizePreviewUrl('http://mindo.vn')?.hostname).toBe('mindo.vn');
  });

  /*
    `file://` đọc trộm tệp của server. `gopher://` và `dict://` là đường kinh
    điển để biến SSRF thành lệnh gửi thẳng tới Redis hay CSDL bên cạnh.
  */
  it.each([
    ['file:///etc/passwd'],
    ['gopher://127.0.0.1:6380/_FLUSHALL'],
    ['dict://localhost:5433/'],
    ['javascript:alert(1)'],
    ['ftp://mindo.vn/x'],
  ])('%s bị từ chối', (value) => {
    expect(normalizePreviewUrl(value)).toBeNull();
  });

  it('link trỏ vào mạng nội bộ bị từ chối', () => {
    expect(normalizePreviewUrl('http://169.254.169.254/latest/meta-data/')).toBeNull();
    expect(normalizePreviewUrl('http://localhost:6380')).toBeNull();
  });

  /* Chứng thực nhúng trong link thường là mồi để server gửi kèm nó đi nơi khác. */
  it('link kèm tài khoản mật khẩu bị từ chối', () => {
    expect(normalizePreviewUrl('http://admin:secret@mindo.vn')).toBeNull();
  });

  it('chuỗi không phải link thì trả null, không nổ', () => {
    expect(normalizePreviewUrl('xin chào')).toBeNull();
    expect(normalizePreviewUrl('')).toBeNull();
  });
});

describe('tìm link trong đoạn chữ', () => {
  it('lấy link đầu tiên', () => {
    expect(firstUrlIn('xem cái này https://mindo.vn/a nhé')).toBe(
      'https://mindo.vn/a',
    );
  });

  /* Chat chỉ vẽ MỘT thẻ, nên chỉ cần link đầu. */
  it('nhiều link thì vẫn chỉ lấy cái đầu', () => {
    expect(firstUrlIn('https://a.vn và https://b.vn')).toBe('https://a.vn');
  });

  it('không có link thì null', () => {
    expect(firstUrlIn('chào bạn')).toBeNull();
  });

  /* Dấu câu dính đuôi câu tiếng Việt: "xem https://mindo.vn." */
  it('không nuốt dấu đóng ngoặc', () => {
    expect(firstUrlIn('(https://mindo.vn/a)')).toBe('https://mindo.vn/a');
  });
});

describe('bóc metadata', () => {
  const page = (head: string) => `<html><head>${head}</head><body>x</body></html>`;

  it('ưu tiên og: rồi mới tới thẻ title', () => {
    const preview = parseLinkPreview(
      page(
        '<title>Tiêu đề thường</title><meta property="og:title" content="Tiêu đề OG">',
      ),
      'https://mindo.vn/a',
    );

    expect(preview?.title).toBe('Tiêu đề OG');
  });

  it('không có og thì rơi về thẻ title', () => {
    expect(
      parseLinkPreview(page('<title>Chỉ có title</title>'), 'https://mindo.vn/a')
        ?.title,
    ).toBe('Chỉ có title');
  });

  /* Không có nổi một cái tiêu đề thì thẻ xem trước chỉ còn mỗi đường link —
     thà để nguyên chữ còn hơn vẽ một ô rỗng. */
  it('không có tiêu đề nào thì trả null', () => {
    expect(parseLinkPreview(page(''), 'https://mindo.vn/a')).toBeNull();
  });

  /* Rất nhiều trang khai `og:image` dạng tương đối; app không biết lấy gốc
     ở đâu nên phải quy về tuyệt đối tại đây. */
  it('ảnh tương đối được quy về tuyệt đối', () => {
    const preview = parseLinkPreview(
      page('<title>T</title><meta property="og:image" content="/img/bia.png">'),
      'https://mindo.vn/tin/abc',
    );

    expect(preview?.image).toBe('https://mindo.vn/img/bia.png');
  });

  /* `og:image` trỏ vào 127.0.0.1 biến máy NGƯỜI DÙNG thành công cụ dò cổng
     trong mạng của chính họ — server chặn hộ, vì app cứ thấy URL là tải. */
  it('ảnh trỏ vào mạng nội bộ bị bỏ', () => {
    const preview = parseLinkPreview(
      page(
        '<title>T</title><meta property="og:image" content="http://127.0.0.1:8080/x.png">',
      ),
      'https://mindo.vn/a',
    );

    expect(preview?.image).toBeNull();
    expect(preview?.title).toBe('T');
  });

  it('tên trang rơi về hostname khi thiếu og:site_name', () => {
    expect(
      parseLinkPreview(page('<title>T</title>'), 'https://www.mindo.vn/a')
        ?.site_name,
    ).toBe('mindo.vn');
  });

  it('cắt bớt tiêu đề quá dài', () => {
    const preview = parseLinkPreview(
      page(`<title>${'a'.repeat(500)}</title>`),
      'https://mindo.vn/a',
    );

    expect(preview!.title.length).toBeLessThanOrEqual(200);
    expect(preview!.title.endsWith('…')).toBe(true);
  });

  it('gom khoảng trắng thừa trong tiêu đề', () => {
    expect(
      parseLinkPreview(page('<title>  Tin\n  mới  </title>'), 'https://mindo.vn/a')
        ?.title,
    ).toBe('Tin mới');
  });
});
