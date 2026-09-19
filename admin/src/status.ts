export function statusDisplay(value: string): { label: string; tone: 'danger' | 'warning' | 'success' } {
  const map: Record<string, string> = { PENDING: 'Chờ duyệt', CONFIRMED: 'Đã xác nhận', APPROVED: 'Hoạt động', COMPLETED: 'Hoàn tất', FAILED: 'Cần kiểm tra', REJECTED: 'Đã từ chối', LOCKED: 'Đã khóa' };
  const tone = value === 'FAILED' || value === 'REJECTED' || value === 'LOCKED' ? 'danger' : value === 'PENDING' ? 'warning' : 'success';
  return { label: map[value] ?? value, tone };
}
