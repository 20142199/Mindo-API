/**
 * "Chrome trên macOS" từ user-agent — chỉ để người dùng nhận ra máy của mình
 * trên màn xác nhận của điện thoại. User-agent do trình duyệt tự khai, nên đây
 * là gợi ý chứ không phải bằng chứng; xem mô hình an toàn trong
 * docs/web-qr-login-design.md.
 *
 * Thứ tự dò quan trọng: user-agent của Edge chứa cả "Chrome", của Chrome chứa
 * cả "Safari".
 */
const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Version\/[\d.]+ .*Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows NT/, 'Windows'],
  [/iPhone|iPad/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/Android/, 'Android'],
  [/Linux/, 'Linux'],
];

export function describeBrowser(userAgent?: string | null): string {
  if (!userAgent) return 'Trình duyệt web';
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (!browser) return 'Trình duyệt web';
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  return system ? `${browser} trên ${system}` : browser;
}
