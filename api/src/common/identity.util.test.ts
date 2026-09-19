import { describe, expect, it } from 'vitest';
import { isNormalizedPhone, normalizeEmail, normalizePhone } from './identity.util';

describe('identity normalization', () => {
  it('normalizes emails for account lookup', () => {
    expect(normalizeEmail('  User@Mindo.VN ')).toBe('user@mindo.vn');
  });

  it('normalizes Vietnamese local and international phone formats', () => {
    expect(normalizePhone('(+84) 901 234 567')).toBe('0901234567');
    expect(normalizePhone('0084-901-234-567')).toBe('0901234567');
    expect(normalizePhone('0901 234 567')).toBe('0901234567');
  });

  it('validates canonical phone lengths', () => {
    expect(isNormalizedPhone('0901234567')).toBe(true);
    expect(isNormalizedPhone('123')).toBe(false);
  });
});
