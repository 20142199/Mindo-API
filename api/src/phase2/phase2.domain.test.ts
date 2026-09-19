import { describe, expect, it } from 'vitest';
import { agencyTierForQuantity, buildAgencyTree, slugifyStoreName } from './phase2.domain';

describe('phase 2 domain rules', () => {
  it('maps package quantities to the three configured tiers', () => {
    expect(agencyTierForQuantity(1)).toMatchObject({ code: 'TIER_1', discountRate: 0.3 });
    expect(agencyTierForQuantity(50)).toMatchObject({ code: 'TIER_2', discountRate: 0.4 });
    expect(agencyTierForQuantity(200)).toMatchObject({ code: 'TIER_3', discountRate: 0.5 });
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
