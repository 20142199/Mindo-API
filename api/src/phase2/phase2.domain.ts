export type AgencyTier = {
  code: 'TIER_1' | 'TIER_2' | 'TIER_3';
  label: string;
  discountRate: number;
};

export function agencyTierForQuantity(quantity: number): AgencyTier {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Số lượng gói phải lớn hơn 0');
  if (quantity < 50) return { code: 'TIER_1', label: 'Gói 1', discountRate: 0.3 };
  if (quantity < 200) return { code: 'TIER_2', label: 'Gói 2', discountRate: 0.4 };
  return { code: 'TIER_3', label: 'Gói 3', discountRate: 0.5 };
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
