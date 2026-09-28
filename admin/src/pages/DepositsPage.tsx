import { Banknote, Check, Clock3, CreditCard, RefreshCw, Search, WalletCards, X } from 'lucide-react';
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
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

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
  const pending = rows.filter((row) => row.status === 'PENDING').length;
  const confirmedTotal = rows.filter((row) => row.status === 'CONFIRMED').reduce((sum, row) => sum + Number(row.amountVnd), 0);
  const expired = rows.filter((row) => row.qr_expired).length;

  async function review(action: 'confirm' | 'reject') {
    if (!selected) return;
    if (action === 'reject' && !note.trim()) { setError('Vui lòng nhập lý do từ chối lệnh nạp.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      if (action === 'confirm') await api.confirmDeposit(selected.id, note.trim());
      else await api.rejectDeposit(selected.id, note.trim());
      setMessage(action === 'confirm' ? 'Đã xác nhận tiền vào và cộng số dư.' : 'Đã từ chối lệnh nạp.');
      setNote('');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể xử lý lệnh nạp'); }
    finally { setBusy(false); }
  }

  return <div className={selected ? 'page operations-page operations-drawer-open' : 'page operations-page'}>
    <section className="operations-main">
      <div className="page-title-row"><div><h1>Nạp tiền VietQR</h1><p>Đối soát tiền vào tự động và xử lý thủ công khi cần.</p></div><button className="outline-button" onClick={() => void load()}><RefreshCw size={17} /> Làm mới</button></div>
      {error ? <div className="error-banner">{error}</div> : null}
      {message ? <div className="success-banner"><Check size={16} /> {message}</div> : null}
      <section className="metric-row">
        <Metric label="Tổng lệnh nạp" value={rows.length.toLocaleString('vi-VN')} icon={WalletCards} />
        <Metric label="Chờ xử lý" value={pending.toLocaleString('vi-VN')} icon={Clock3} />
        <Metric label="QR đã hết hạn" value={expired.toLocaleString('vi-VN')} icon={CreditCard} />
        <Metric label="Đã ghi có" value={money.format(confirmedTotal)} icon={Banknote} moneyValue />
      </section>
      <section className="work-panel">
        <div className="filters compact-filters"><label className="search"><Search size={18} /><input aria-label="Tìm lệnh nạp" placeholder="Tìm mã nạp, người dùng hoặc mã ngân hàng" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="select-label"><span>Trạng thái</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Tất cả</option><option value="PENDING">Chờ xử lý</option><option value="CONFIRMED">Đã xác nhận</option><option value="REJECTED">Đã từ chối</option></select></label></div>
        <div className="table-heading"><h2>Danh sách lệnh nạp</h2></div>
        <div className="table-scroll"><table><thead><tr><th>Mã nạp</th><th>Khách hàng</th><th>Số tiền</th><th>Đối soát</th><th>Trạng thái</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead><tbody>
          {visible.map((row) => { const display = statusDisplay(row.status); return <tr key={row.id} className={selected?.id === row.id ? 'selected-row' : ''}><td><strong>{row.transferCode}</strong><small>{row.vietQrOrderId || row.id}</small></td><td><strong>{row.user.fullName}</strong><small>{row.user.email}</small></td><td>{money.format(Number(row.amountVnd))}</td><td>{row.bankTransactionId ? <><strong>{row.bankTransactionId}</strong><small>{row.bankReferenceNumber || 'Đã nhận webhook'}</small></> : row.qr_expired ? <span className="status danger">QR hết hạn</span> : <span className="muted-cell">Chưa nhận tiền</span>}</td><td><span className={`status ${display.tone}`}>{display.label}</span></td><td>{dateTime.format(new Date(row.createdAt))}</td><td><button className="text-button" onClick={() => { setSelected(row); setNote(''); setMessage(''); }}>Xem chi tiết</button></td></tr>; })}
          {visible.length === 0 ? <tr><td colSpan={7} className="empty">Không có lệnh nạp phù hợp.</td></tr> : null}
        </tbody></table></div>
        <footer className="table-footer"><span>Hiển thị <strong>{visible.length}</strong> / {rows.length} lệnh nạp</span></footer>
      </section>
    </section>
    {selected ? <DepositDrawer row={selected} note={note} busy={busy} onNote={setNote} onClose={() => setSelected(undefined)} onReview={review} /> : null}
  </div>;
}

function Metric({ label, value, icon: Icon, moneyValue }: { label: string; value: string; icon: typeof WalletCards; moneyValue?: boolean }) {
  return <div className="metric"><span className="metric-icon"><Icon /></span><span><small>{label}</small><strong className={moneyValue ? 'metric-money' : ''}>{value}</strong></span></div>;
}

function DepositDrawer({ row, note, busy, onNote, onClose, onReview }: { row: DepositRow; note: string; busy: boolean; onNote: (value: string) => void; onClose: () => void; onReview: (action: 'confirm' | 'reject') => void }) {
  const display = statusDisplay(row.status);
  const qr = row.vietqr;
  return <aside className="detail-drawer" aria-label="Chi tiết lệnh nạp">
    <header><h2>Chi tiết lệnh nạp</h2><button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={19} /></button></header>
    <div className="drawer-hero"><span className="agency-logo"><WalletCards /></span><span><strong>{money.format(Number(row.amountVnd))}</strong><small>{row.transferCode}</small></span><span className={`status ${display.tone}`}>{display.label}</span></div>
    <DrawerSection title="Người nạp"><Info label="Họ tên" value={row.user.fullName} /><Info label="Email" value={row.user.email} /><Info label="Điện thoại" value={row.user.phone || 'Chưa cập nhật'} /></DrawerSection>
    <DrawerSection title="Thông tin VietQR"><Info label="Ngân hàng" value={qr?.bank_code || 'ACB'} /><Info label="Số tài khoản" value={qr?.bank_account || '13989647'} /><Info label="Chủ tài khoản" value={qr?.account_name || 'TRAN DUY HUNG'} /><Info label="Nội dung" value={qr?.transfer_content || row.transferCode} /><Info label="Hạn QR" value={row.expires_at ? dateTime.format(new Date(row.expires_at)) : '—'} /></DrawerSection>
    <DrawerSection title="Đối soát ngân hàng"><Info label="Mã giao dịch" value={row.bankTransactionId || 'Chưa có'} /><Info label="Mã tham chiếu" value={row.bankReferenceNumber || '—'} /><Info label="Thực nhận" value={row.paidAmountVnd ? money.format(Number(row.paidAmountVnd)) : '—'} /><Info label="Thời gian nhận" value={row.paidAt ? dateTime.format(new Date(row.paidAt)) : '—'} /></DrawerSection>
    {row.status === 'PENDING' ? <><label className="drawer-note">Ghi chú xử lý<textarea value={note} onChange={(event) => onNote(event.target.value)} placeholder="Nhập ghi chú hoặc lý do từ chối..." /></label><div className="drawer-review-actions"><button className="reject-button" disabled={busy || !note.trim()} onClick={() => onReview('reject')}>Từ chối</button><button className="primary-button" disabled={busy} onClick={() => onReview('confirm')}>Xác nhận tiền vào</button></div></> : <div className="drawer-result"><strong>Đã xử lý</strong><span>{row.reviewNote || 'Giao dịch đã được hệ thống ghi nhận.'}</span></div>}
  </aside>;
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="drawer-section"><h3>{title}</h3><dl>{children}</dl></section>; }
function Info({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
