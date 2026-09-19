import { describe, expect, it } from 'vitest';
import { availableSupply, requireAvailableSupply } from './domain';

describe('internal NFT supply', () => {
  it('subtracts sold units from available supply', () => {
    expect(availableSupply(100, 60)).toBe(40);
  });

  it('prevents overselling internal supply', () => {
    expect(() => requireAvailableSupply(100, 60, 41)).toThrow('Không đủ NFT khả dụng');
  });

  it('accepts the exact remaining quantity', () => {
    expect(() => requireAvailableSupply(100, 60, 40)).not.toThrow();
  });
});
