import { Banknote, Clock3, CreditCard, RefreshCw, Search, WalletCards, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type DepositRow } from '../api';
import { statusDisplay } from '../status';

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

export function DepositsPage() {
  const [rows, setRows] = useState<DepositRow[]>([]);
  const [selected, setSelected] = useState<DepositRow>();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const next = await api.deposits();
      setRows(next);
      if (selected) setSelected(next.find((row) => row.id === selected.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải lệnh nạp'); }
  }
  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => rows.filter((row) => {
    const text = `${row.transferCode} ${row.user.fullName} ${row.user.email} ${row.bankTransactionId ?? ''}`.toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (status === 'ALL' || row.status === status);
  }), [rows, query, status]);
  const pendingRows = rows.filter((row) => row.status === 'PENDING');
  const confirmedRows = rows.filter((row) => row.status === 'CONFIRMED');
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const confirmedTotal = confirmedRows.reduce((sum, row) => sum + Number(row.amountVnd), 0);
  const confirmedToday = confirmedRows
    .filter((row) => new Date(row.paidAt ?? row.createdAt) >= startOfToday)
    .reduce((sum, row) => sum + Number(row.amountVnd), 0);
  const pendingTotal = pendingRows.reduce((sum, row) => sum + Number(row.amountVnd), 0);

  return <div className={selected ? 'page operations-page operations-drawer-open' : 'page operations-page'}>
    <section className="operations-main">
      <div className="page-title-row"><div><h1>Lịch sử nạp tiền</h1><p>Theo dõi toàn bộ lệnh nạp; tiền vào được đối soát và ghi có tự động qua callback VietQR.</p></div><button className="outline-button" onClick={() => void load()}><RefreshCw size={17} /> Làm mới</button></div>
      {error ? <div className="error-banner">{error}</div> : null}
      <section className="metric-row">
        <Metric label="Tổng tiền đã nạp" value={money.format(confirmedTotal)} icon={Banknote} moneyValue />
        <Metric label="Tiền nạp hôm nay" value={money.format(confirmedToday)} icon={Clock3} moneyValue />
        <Metric label={`Đang chờ (${pendingRows.length} lệnh)`} value={money.format(pendingTotal)} icon={CreditCard} moneyValue />
        <Metric label="Tổng số giao dịch" value={rows.length.toLocaleString('vi-VN')} icon={WalletCards} />
      </section>
      <section className="work-panel">
        <div className="filters compact-filters"><label className="search"><Search size={18} /><input aria-label="Tìm lệnh nạp" placeholder="Tìm mã nạp, người dùng hoặc mã ngân hàng" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="select-label"><span>Trạng thái</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Tất cả</option><option value="PENDING">Chờ thanh toán</option><option value="CONFIRMED">Đã ghi có</option><option value="REJECTED">Đã từ chối</option></select></label></div>
        <div className="table-heading"><h2>Lịch sử giao dịch nạp</h2></div>
        <div className="table-scroll"><table><thead><tr><th>Mã nạp</th><th>Khách hàng</th><th>Số tiền</th><th>Đối soát</th><th>Trạng thái</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead><tbody>
          {visible.map((row) => { const display = depositStatus(row); return <tr key={row.id} className={selected?.id === row.id ? 'selected-row' : ''}><td><strong>{row.transferCode}</strong><small>{row.vietQrOrderId || row.id}</small></td><td><strong>{row.user.fullName}</strong><small>{row.user.email}</small></td><td>{money.format(Number(row.amountVnd))}</td><td>{row.bankTransactionId ? <><strong>{row.bankTransactionId}</strong><small>{row.bankReferenceNumber || 'Đã nhận callback'}</small></> : row.qr_expired ? <span className="status danger">QR hết hạn</span> : <span className="muted-cell">Chưa nhận tiền</span>}</td><td><span className={`status ${display.tone}`}>{display.label}</span></td><td>{dateTime.format(new Date(row.createdAt))}</td><td><button className="text-button" onClick={() => setSelected(row)}>Xem chi tiết</button></td></tr>; })}
          {visible.length === 0 ? <tr><td colSpan={7} className="empty">Không có lệnh nạp phù hợp.</td></tr> : null}
        </tbody></table></div>
        <footer className="table-footer"><span>Hiển thị <strong>{visible.length}</strong> / {rows.length} lệnh nạp</span></footer>
      </section>
    </section>
    {selected ? <DepositDrawer row={selected} onClose={() => setSelected(undefined)} /> : null}
  </div>;
}

function Metric({ label, value, icon: Icon, moneyValue }: { label: string; value: string; icon: typeof WalletCards; moneyValue?: boolean }) {
  return <div className="metric"><span className="metric-icon"><Icon /></span><span><small>{label}</small><strong className={moneyValue ? 'metric-money' : ''}>{value}</strong></span></div>;
}

function DepositDrawer({ row, onClose }: { row: DepositRow; onClose: () => void }) {
  const display = depositStatus(row);
  const qr = row.vietqr;
  return <aside className="detail-drawer" aria-label="Chi tiết lệnh nạp">
    <header><h2>Chi tiết lệnh nạp</h2><button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={19} /></button></header>
    <div className="drawer-hero"><span className="agency-logo"><WalletCards /></span><span><strong>{money.format(Number(row.amountVnd))}</strong><small>{row.transferCode}</small></span><span className={`status ${display.tone}`}>{display.label}</span></div>
    <DrawerSection title="Người nạp"><Info label="Họ tên" value={row.user.fullName} /><Info label="Email" value={row.user.email} /><Info label="Điện thoại" value={row.user.phone || 'Chưa cập nhật'} /></DrawerSection>
    <DrawerSection title="Thông tin VietQR"><Info label="Ngân hàng" value={qr?.bank_code || 'ACB'} /><Info label="Số tài khoản" value={qr?.bank_account || '13989647'} /><Info label="Chủ tài khoản" value={qr?.account_name || 'TRAN DUY HUNG'} /><Info label="Nội dung" value={qr?.transfer_content || row.transferCode} /><Info label="Hạn QR" value={row.expires_at ? dateTime.format(new Date(row.expires_at)) : '—'} /></DrawerSection>
    <DrawerSection title="Đối soát ngân hàng"><Info label="Mã giao dịch" value={row.bankTransactionId || 'Chưa có'} /><Info label="Mã tham chiếu" value={row.bankReferenceNumber || '—'} /><Info label="Thực nhận" value={row.paidAmountVnd ? money.format(Number(row.paidAmountVnd)) : '—'} /><Info label="Thời gian nhận" value={row.paidAt ? dateTime.format(new Date(row.paidAt)) : '—'} /></DrawerSection>
    {row.status === 'PENDING' ? <div className="drawer-result pending"><strong>{row.qr_expired ? 'QR đã hết hạn' : 'Đang chờ khách hàng chuyển khoản'}</strong><span>Không cần Admin xác nhận. Khi VietQR gửi callback hợp lệ, hệ thống sẽ tự động cộng số dư và cập nhật trạng thái.</span></div> : <div className="drawer-result"><strong>{row.status === 'CONFIRMED' ? 'Đã ghi có tự động' : 'Lệnh nạp đã kết thúc'}</strong><span>{row.reviewNote || 'Giao dịch đã được hệ thống ghi nhận.'}</span></div>}
  </aside>;
}

function depositStatus(row: DepositRow) {
  if (row.qr_expired && row.status === 'PENDING') return { label: 'QR hết hạn', tone: 'danger' as const };
  if (row.status === 'PENDING') return { label: 'Chờ thanh toán', tone: 'warning' as const };
  if (row.status === 'CONFIRMED') return { label: 'Đã ghi có', tone: 'success' as const };
  return statusDisplay(row.status);
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="drawer-section"><h3>{title}</h3><dl>{children}</dl></section>; }
function Info({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
