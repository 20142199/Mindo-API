import { Box, CalendarDays, RefreshCw, Search, UserRoundCheck, WalletCards, Waypoints } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type DashboardMetrics, type DepositRow, type KycRow, type TransactionRow } from '../api';
import { statusDisplay } from '../status';

type WorkItem = { id: string; type: string; name: string; email: string; amount?: string; status: string; createdAt: string; kyc?: KycRow };

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

export function DashboardPage({ onOpenKyc }: { onOpenKyc: (kyc: KycRow) => void }) {
  const [metrics, setMetrics] = useState<DashboardMetrics>();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const [nextMetrics, kyc, deposits, transactions] = await Promise.all([api.dashboard(), api.kyc(), api.deposits(), api.transactions()]);
      setMetrics(nextMetrics);
      setItems([
        ...kyc.map((row: KycRow): WorkItem => ({ id: row.id, type: 'KYC', name: row.fullName, email: row.user.email, status: row.status, createdAt: row.createdAt, kyc: row })),
        ...deposits.map((row: DepositRow): WorkItem => ({ id: row.id, type: 'Nạp tiền', name: row.user.fullName, email: row.user.email, amount: row.amountVnd, status: row.status, createdAt: row.createdAt })),
        ...transactions.map((row: TransactionRow): WorkItem => ({ id: row.id, type: 'Giao dịch', name: row.user.fullName, email: row.user.email, amount: row.totalVnd, status: row.status, createdAt: row.createdAt })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu'); }
  }

  useEffect(() => { void load(); }, []);
  const visibleItems = useMemo(() => items.filter((item) => {
    const matchesText = `${item.name} ${item.email} ${item.id}`.toLowerCase().includes(query.toLowerCase());
    return matchesText && (status === 'ALL' || item.status === status);
  }), [items, query, status]);

  const cards = [
    { label: 'KYC chờ duyệt', value: metrics?.kyc_pending ?? '—', icon: UserRoundCheck },
    { label: 'Lệnh nạp chờ xử lý', value: metrics?.deposits_pending ?? '—', icon: WalletCards },
    { label: 'NFT đã bán', value: metrics?.nft_sold ?? '—', icon: Box },
    { label: 'Giao dịch cần kiểm tra', value: metrics?.transactions_need_review ?? '—', icon: Waypoints },
  ];

  return (
    <div className="page dashboard-page">
      <h1>Tổng quan vận hành</h1>
      {error ? <div className="error-banner">{error}. Hãy kiểm tra API hoặc bật VITE_DEMO_MODE=true để xem dữ liệu mẫu.</div> : null}
      <section className="metric-row" aria-label="Chỉ số vận hành">
        {cards.map(({ label, value, icon: Icon }) => <div className="metric" key={label}><span className="metric-icon"><Icon /></span><span><small>{label}</small><strong>{typeof value === 'number' ? value.toLocaleString('vi-VN') : value}</strong></span></div>)}
      </section>
      <section className="work-panel">
        <div className="filters">
          <label className="search"><Search size={18} /><input aria-label="Tìm kiếm" placeholder="Tìm kiếm người dùng, mã giao dịch..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="select-label"><span>Trạng thái</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Tất cả</option><option value="PENDING">Chờ duyệt</option><option value="CONFIRMED">Đã xác nhận</option><option value="COMPLETED">Hoàn tất</option><option value="FAILED">Cần kiểm tra</option></select></label>
          <label className="date-filter"><CalendarDays size={17} /> 01/09/2026 - 07/09/2026</label>
          <button className="outline-button" onClick={() => void load()}><RefreshCw size={17} /> Làm mới</button>
        </div>
        <div className="table-heading"><h2>Công việc cần xử lý</h2></div>
        <div className="table-scroll"><table><thead><tr><th>Loại</th><th>Người dùng</th><th>Số tiền</th><th>Trạng thái</th><th>Thời gian</th><th>Thao tác</th></tr></thead><tbody>
          {visibleItems.map((item) => <tr key={`${item.type}-${item.id}`}><td>{item.type}</td><td><strong>{item.name}</strong><small>{item.email}</small></td><td>{item.amount ? money.format(Number(item.amount)) : '—'}</td><td><Status value={item.status} /></td><td>{dateTime.format(new Date(item.createdAt))}</td><td><button className="text-button" onClick={() => item.kyc && onOpenKyc(item.kyc)} disabled={!item.kyc}>Xem chi tiết</button></td></tr>)}
          {visibleItems.length === 0 ? <tr><td colSpan={6} className="empty">Không có công việc phù hợp.</td></tr> : null}
        </tbody></table></div>
        <footer className="table-footer"><span>Hiển thị <strong>{visibleItems.length}</strong> công việc</span><span className="pagination"><button disabled aria-label="Trang trước">‹</button><button className="current" aria-label="Trang 1">1</button><button disabled aria-label="Trang sau">›</button></span></footer>
      </section>
    </div>
  );
}

function Status({ value }: { value: string }) {
  const status = statusDisplay(value);
  return <span className={`status ${status.tone}`}>{status.label}</span>;
}
