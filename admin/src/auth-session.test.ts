import { describe, expect, it } from 'vitest';
import { isTokenExpired, tokenExpiresAt } from './auth-session';

function jwt(payload: Record<string, unknown>) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

describe('admin auth session', () => {
  it('reads the JWT expiration time', () => {
    expect(tokenExpiresAt(jwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
  });

  it('detects an expired token', () => {
    const token = jwt({ exp: 100 });
    expect(isTokenExpired(token, 100_001)).toBe(true);
    expect(isTokenExpired(token, 99_999)).toBe(false);
  });

  it('does not expire an opaque or malformed token locally', () => {
    expect(tokenExpiresAt('not-a-jwt')).toBeUndefined();
    expect(isTokenExpired('not-a-jwt', Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});
