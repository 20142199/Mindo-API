import { randomBytes } from 'node:crypto';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function referralCode(prefix: 'MD' | 'SYS', entropy = randomBytes(8)) {
  let suffix = '';
  for (let index = 0; index < 8; index += 1) suffix += alphabet[entropy[index] % alphabet.length];
  return `${prefix}${suffix}`;
}

export function percentToRate(percent: number) {
  return percent / 100;
}

export function rateToPercent(rate: { toNumber(): number } | number) {
  return (typeof rate === 'number' ? rate : rate.toNumber()) * 100;
}

