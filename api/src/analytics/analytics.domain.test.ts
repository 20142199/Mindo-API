import { describe, expect, it } from 'vitest';
import { analyticsBucketKey, percentageChange, resolveAnalyticsPeriod } from './analytics.domain';

describe('analytics date helpers', () => {
  it('uses Vietnam calendar boundaries and an equal previous period', () => {
    const period = resolveAnalyticsPeriod('2026-09-01', '2026-09-30', 'day');
    expect(period.start.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(period.endExclusive.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(period.previousStart.toISOString()).toBe('2026-08-01T17:00:00.000Z');
  });

  it('groups weeks from Monday in Vietnam time', () => {
    expect(analyticsBucketKey(new Date('2026-09-30T18:30:00.000Z'), 'day')).toBe('2026-10-01');
    expect(analyticsBucketKey(new Date('2026-09-30T18:30:00.000Z'), 'week')).toBe('2026-09-28');
    expect(analyticsBucketKey(new Date('2026-09-30T18:30:00.000Z'), 'month')).toBe('2026-10');
  });

  it('does not invent a percentage when the previous value is zero', () => {
    expect(percentageChange(100, 0)).toBeNull();
    expect(percentageChange(0, 0)).toBe(0);
    expect(percentageChange(120, 100)).toBe(20);
  });
});

