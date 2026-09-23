import { describe, expect, it } from 'vitest';
import {
  agencyTierForTotal,
  buildAgencyTree,
  priceAgencyPackages,
  resolveSseMaxStreamMs,
  slugifyStoreName,
} from './phase2.domain';

describe('phase 2 domain rules', () => {
  it('maps cumulative package totals to the three agency titles', () => {
    expect(agencyTierForTotal(1)).toMatchObject({ code: 'TIER_1', label: 'Đại lý 1', discountRate: 0.2 });
    expect(agencyTierForTotal(50)).toMatchObject({ code: 'TIER_2', label: 'Đại lý 2', discountRate: 0.3 });
    expect(agencyTierForTotal(200)).toMatchObject({ code: 'TIER_3', label: 'Đại lý 3', discountRate: 0.4 });
  });

  it('applies the higher discount only from the package that reaches its threshold', () => {
    const price = priceAgencyPackages(40, 20, 625_000);
    expect(price.attainedTier.code).toBe('TIER_2');
    expect(price.breakdown).toEqual([
      expect.objectContaining({ tier: 'TIER_1', from_package: 41, to_package: 49, quantity: 9, discount_rate: 0.2 }),
      expect.objectContaining({ tier: 'TIER_2', from_package: 50, to_package: 60, quantity: 11, discount_rate: 0.3 }),
    ]);
    expect(price.netAmountVnd).toBe(9 * 500_000 + 11 * 437_500);
  });

  it('creates stable store slugs from Vietnamese names', () => {
    expect(slugifyStoreName('Cửa hàng Mindo Quận 1')).toBe('cua-hang-mindo-quan-1');
  });

  it('builds a nested agency tree', () => {
    const tree = buildAgencyTree([
      { id: 'root', parentId: null, name: 'Root' },
      { id: 'child', parentId: 'root', name: 'Child' },
      { id: 'grandchild', parentId: 'child', name: 'Grandchild' },
    ]);
    expect(tree).toHaveLength(1);
    expect((tree[0].children[0] as { children: unknown[] }).children).toHaveLength(1);
  });
});

/**
 * Safety net for the SSE stream ceiling (2026-09-24).
 *
 * The floor matters more than the default here: a ceiling of a second or two
 * would close every stream before the first answer ever arrived, and it would
 * look exactly like the AI being broken rather than like a bad setting.
 */
describe('SSE stream ceiling', () => {
  it('falls back to three minutes when unset', () => {
    expect(resolveSseMaxStreamMs(undefined)).toBe(180_000);
  });

  it('accepts a longer ceiling', () => {
    expect(resolveSseMaxStreamMs('600000')).toBe(600_000);
  });

  it('refuses anything under the 30s floor', () => {
    expect(resolveSseMaxStreamMs('1000')).toBe(180_000);
    expect(resolveSseMaxStreamMs('0')).toBe(180_000);
  });

  it('refuses a value that is not a number', () => {
    expect(resolveSseMaxStreamMs('forever')).toBe(180_000);
  });
});
