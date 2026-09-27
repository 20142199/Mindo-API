import { describe, expect, it } from 'vitest';
import { describeBrowser } from './web-login.browser';

/**
 * Chuỗi hiện trên màn xác nhận của điện thoại — để người dùng nhận ra máy mình
 * trước khi bấm "Đăng nhập". Thứ tự dò là chỗ dễ sai: user-agent của Edge chứa
 * cả "Chrome", của Chrome chứa cả "Safari".
 */
describe('describeBrowser', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'Chrome trên macOS'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0', 'Edge trên Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15', 'Safari trên macOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox trên Linux'],
  ])('%s', (ua, expected) => expect(describeBrowser(ua)).toBe(expected));

  it('không đọc được thì trả câu chung', () => {
    expect(describeBrowser(undefined)).toBe('Trình duyệt web');
    expect(describeBrowser('curl/8.4')).toBe('Trình duyệt web');
  });
});
