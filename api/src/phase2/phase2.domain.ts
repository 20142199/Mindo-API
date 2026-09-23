export type AgencyTier = {
  code: 'TIER_1' | 'TIER_2' | 'TIER_3';
  label: string;
  discountRate: number;
  fromPackage: number;
  toPackage: number | null;
};

export const agencyTiers: AgencyTier[] = [
  { code: 'TIER_1', label: 'Đại lý 1', discountRate: 0.20, fromPackage: 1, toPackage: 49 },
  { code: 'TIER_2', label: 'Đại lý 2', discountRate: 0.30, fromPackage: 50, toPackage: 199 },
  { code: 'TIER_3', label: 'Đại lý 3', discountRate: 0.40, fromPackage: 200, toPackage: null },
];

export function agencyTierForTotal(totalPackages: number): AgencyTier {
  if (!Number.isInteger(totalPackages) || totalPackages < 1) throw new Error('Tổng số gói phải lớn hơn 0');
  return agencyTiers.find((tier) => totalPackages >= tier.fromPackage && (tier.toPackage === null || totalPackages <= tier.toPackage))!;
}

export function priceAgencyPackages(totalBefore: number, quantity: number, unitPriceVnd: number) {
  if (!Number.isInteger(totalBefore) || totalBefore < 0) throw new Error('Tổng số gói hiện tại không hợp lệ');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Số lượng gói phải lớn hơn 0');
  if (!Number.isInteger(unitPriceVnd) || unitPriceVnd < 1) throw new Error('Giá quy đổi VND không hợp lệ');
  const startingPackageNumber = totalBefore + 1;
  const endingPackageNumber = totalBefore + quantity;
  const breakdown = agencyTiers.flatMap((tier) => {
    const segmentStart = Math.max(startingPackageNumber, tier.fromPackage);
    const segmentEnd = Math.min(endingPackageNumber, tier.toPackage ?? endingPackageNumber);
    if (segmentStart > segmentEnd) return [];
    const segmentQuantity = segmentEnd - segmentStart + 1;
    const grossAmountVnd = unitPriceVnd * segmentQuantity;
    const netAmountVnd = Math.round(grossAmountVnd * (1 - tier.discountRate));
    return [{
      tier: tier.code,
      title: tier.label,
      from_package: segmentStart,
      to_package: segmentEnd,
      quantity: segmentQuantity,
      discount_rate: tier.discountRate,
      gross_amount_vnd: grossAmountVnd,
      net_amount_vnd: netAmountVnd,
    }];
  });
  const grossAmountVnd = unitPriceVnd * quantity;
  const netAmountVnd = breakdown.reduce((sum, segment) => sum + segment.net_amount_vnd, 0);
  return {
    startingPackageNumber,
    endingPackageNumber,
    grossAmountVnd,
    netAmountVnd,
    effectiveDiscountRate: (grossAmountVnd - netAmountVnd) / grossAmountVnd,
    attainedTier: agencyTierForTotal(endingPackageNumber),
    breakdown,
  };
}

export function slugifyStoreName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'mindo-store';
}

export function buildAgencyTree<T extends { id: string; parentId: string | null }>(rows: T[]) {
  const childrenByParent = new Map<string | null, T[]>();
  for (const row of rows) {
    const group = childrenByParent.get(row.parentId) ?? [];
    group.push(row);
    childrenByParent.set(row.parentId, group);
  }
  const visit = (row: T, seen: Set<string>): Array<T & { children: unknown[] }> => {
    if (seen.has(row.id)) return [];
    const nextSeen = new Set(seen).add(row.id);
    return [{ ...row, children: (childrenByParent.get(row.id) ?? []).flatMap((child) => visit(child, nextSeen)) }];
  };
  const knownIds = new Set(rows.map((row) => row.id));
  const roots = rows.filter((row) => !row.parentId || !knownIds.has(row.parentId));
  return roots.flatMap((row) => visit(row, new Set()));
}
