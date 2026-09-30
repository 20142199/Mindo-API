import { describe, expect, it } from 'vitest';
import { pathForRoute, routeFromPath, routePaths } from './routing';

describe('admin URL routing', () => {
  it('round-trips every navigation item through a stable URL', () => {
    for (const route of Object.keys(routePaths) as Array<keyof typeof routePaths>) {
      expect(routeFromPath(pathForRoute(route))).toBe(route);
    }
  });

  it('keeps deep links after reload and tolerates a trailing slash', () => {
    expect(routeFromPath('/ai-experts')).toBe('ai-experts');
    expect(routeFromPath('/ai-experts/')).toBe('ai-experts');
    expect(routeFromPath('/withdrawals')).toBe('withdrawals');
    expect(routeFromPath('/analytics')).toBe('analytics');
  });

  it('falls back safely for an unknown URL', () => {
    expect(routeFromPath('/not-a-real-admin-page')).toBe('dashboard');
  });
});
