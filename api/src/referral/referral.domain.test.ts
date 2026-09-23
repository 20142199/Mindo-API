import { describe, expect, it } from 'vitest';
import { percentToRate, rateToPercent, referralCode } from './referral.domain';

describe('referral domain', () => {
  it('creates readable user and system codes', () => {
    const entropy = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(referralCode('MD', entropy)).toBe('MDABCDEFGH');
    expect(referralCode('SYS', entropy)).toBe('SYSABCDEFGH');
  });

  it('converts configurable percentages to stored rates', () => {
    expect(percentToRate(10)).toBe(0.1);
    expect(rateToPercent(0.05)).toBe(5);
  });
});

