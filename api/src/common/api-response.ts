export type Extra = {
  has_more: boolean;
  last_page: number;
  limit: number;
  page: number;
  total: number;
};

const emptyExtra: Extra = { has_more: false, last_page: 1, limit: 0, page: 1, total: 0 };

export function ok<T>(data: T, message = 'Thành công', extra: Extra = emptyExtra) {
  return { code: 200, data, message, extra };
}

export function pageExtra(page: number, limit: number, total: number): Extra {
  const lastPage = Math.max(1, Math.ceil(total / limit));
  return { has_more: page < lastPage, last_page: lastPage, limit, page, total };
}
