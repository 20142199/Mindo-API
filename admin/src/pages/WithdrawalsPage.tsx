import { HandCoins, Check, Clock3, ImagePlus, RefreshCw, RotateCcw, Search, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type WithdrawalRow } from '../api';

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

const statusMeta = (status: WithdrawalRow['status']) => status === 'APPROVED'
  ? { label: 'Đã chuyển tiền', tone: 'success' }
  : status === 'REJECTED'
    ? { label: 'Đã từ chối & hoàn tiền', tone: 'danger' }
    : { label: 'Chờ duyệt', tone: 'warning' };

export function WithdrawalsPage() {
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [selected, setSelected] = useState<WithdrawalRow>();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [transactionCode, setTransactionCode] = useState('');
  const [proof, setProof] = useState<File>();
  const [reviewNote, setReviewNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    setError('');
    try {
      const next = await api.withdrawals();
      setRows(next);
      if (selected) setSelected(next.find((row) => row.id === selected.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải lệnh rút'); }
  }

  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => rows.filter((row) => {
    const text = `${row.id} ${row.user.fullName} ${row.user.email} ${row.bankName} ${row.bankAccountNumber} ${row.bankTransactionCode ?? ''}`.toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (status === 'ALL' || row.status === status);
  }), [rows, query, status]);

  const pending = rows.filter((row) => row.status === 'PENDING');
  const approved = rows.filter((row) => row.status === 'APPROVED');
  const rejected = rows.filter((row) => row.status === 'REJECTED');

  function open(row: WithdrawalRow) {
    setSelected(row); setTransactionCode(''); setProof(undefined); setReviewNote(''); setRejectionReason(''); setError(''); setMessage('');
  }

  async function approve() {
    if (!selected || !proof || transactionCode.trim().length < 3) { setError('Cần nhập mã giao dịch và chọn ảnh chuyển khoản thành công.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const uploaded = await api.uploadWithdrawalProof(proof);
      await api.approveWithdrawal(selected.id, transactionCode.trim(), uploaded.id, reviewNote.trim());
      setMessage('Đã duyệt lệnh, lưu bằng chứng chuyển khoản và gửi thông báo cho user.');
      setProof(undefined); setTransactionCode(''); setReviewNote('');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể duyệt lệnh rút'); }
    finally { setBusy(false); }
  }

  async function reject() {
    if (!selected || rejectionReason.trim().length < 3) { setError('Vui lòng nhập rõ lý do từ chối.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      await api.rejectWithdrawal(selected.id, rejectionReason.trim());
      setMessage('Đã từ chối, hoàn tiền về số dư Mindo và gửi thông báo cho user.');
      setRejectionReason('');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể từ chối lệnh rút'); }
    finally { setBusy(false); }
  }

  return <div className={selected ? 'page operations-page operations-drawer-open' : 'page operations-page'}>
    <section className="operations-main">
      <div className="page-title-row"><div><h1>Rút tiền</h1><p>Duyệt chuyển khoản và kiểm soát hoàn tiền cho từng lệnh rút.</p></div><button className="outline-button" onClick={() => void load()}><RefreshCw size={17} /> Làm mới</button></div>
      {error ? <div className="error-banner">{error}</div> : null}
      {message ? <div className="success-banner"><Check size={16} /> {message}</div> : null}
      <section className="metric-row">
        <Metric label="Chờ duyệt" value={pending.length.toLocaleString('vi-VN')} icon={Clock3} />
        <Metric label="Số tiền đang giữ" value={money.format(pending.reduce((sum, row) => sum + Number(row.amountVnd), 0))} icon={HandCoins} />
        <Metric label="Đã chuyển thành công" value={approved.length.toLocaleString('vi-VN')} icon={ShieldCheck} />
        <Metric label="Đã hoàn tiền" value={rejected.length.toLocaleString('vi-VN')} icon={RotateCcw} />
      </section>
      <section className="work-panel">
        <div className="filters compact-filters"><label className="search"><Search size={18} /><input aria-label="Tìm lệnh rút" placeholder="Tìm user, ngân hàng, số tài khoản hoặc mã giao dịch" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="select-label"><span>Trạng thái</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Tất cả</option><option value="PENDING">Chờ duyệt</option><option value="APPROVED">Đã chuyển tiền</option><option value="REJECTED">Đã từ chối &amp; hoàn tiền</option></select></label></div>
        <div className="table-heading"><h2>Danh sách lệnh rút</h2></div>
        <div className="table-scroll"><table><thead><tr><th>Mã lệnh</th><th>Khách hàng</th><th>Số tiền</th><th>Ngân hàng nhận</th><th>Trạng thái</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead><tbody>
          {visible.map((row) => { const display = statusMeta(row.status); return <tr key={row.id} className={selected?.id === row.id ? 'selected-row' : ''}><td><strong>WD#{row.id.slice(-8).toUpperCase()}</strong></td><td><strong>{row.user.fullName}</strong><small>{row.user.email}</small></td><td><strong>{money.format(Number(row.amountVnd))}</strong><small>Đã giữ khỏi số dư</small></td><td><strong>{row.bankName}</strong><small>{row.bankAccountNumber}</small></td><td><span className={`status ${display.tone}`}>{display.label}</span></td><td>{dateTime.format(new Date(row.createdAt))}</td><td><button className="text-button" onClick={() => open(row)}>Xem chi tiết</button></td></tr>; })}
          {visible.length === 0 ? <tr><td className="empty" colSpan={7}>Không có lệnh rút phù hợp.</td></tr> : null}
        </tbody></table></div>
        <footer className="table-footer"><span>Hiển thị <strong>{visible.length}</strong> / {rows.length} lệnh rút</span></footer>
      </section>
    </section>
    {selected ? <WithdrawalDrawer row={selected} transactionCode={transactionCode} reviewNote={reviewNote} rejectionReason={rejectionReason} proof={proof} busy={busy} onTransactionCode={setTransactionCode} onReviewNote={setReviewNote} onRejectionReason={setRejectionReason} onProof={setProof} onApprove={approve} onReject={reject} onClose={() => setSelected(undefined)} /> : null}
  </div>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Clock3 }) {
  return <div className="metric"><span className="metric-icon"><Icon /></span><span><small>{label}</small><strong>{value}</strong></span></div>;
}

function WithdrawalDrawer({ row, transactionCode, reviewNote, rejectionReason, proof, busy, onTransactionCode, onReviewNote, onRejectionReason, onProof, onApprove, onReject, onClose }: {
  row: WithdrawalRow; transactionCode: string; reviewNote: string; rejectionReason: string; proof?: File; busy: boolean;
  onTransactionCode: (value: string) => void; onReviewNote: (value: string) => void; onRejectionReason: (value: string) => void; onProof: (file?: File) => void;
  onApprove: () => void; onReject: () => void; onClose: () => void;
}) {
  const display = statusMeta(row.status);
  return <aside className="detail-drawer withdrawal-drawer" aria-label="Chi tiết lệnh rút">
    <header><h2>Chi tiết lệnh rút</h2><button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={19} /></button></header>
    <div className="drawer-hero"><span className="agency-logo"><HandCoins /></span><span><strong>{money.format(Number(row.amountVnd))}</strong><small>WD#{row.id.slice(-8).toUpperCase()}</small></span><span className={`status ${display.tone}`}>{display.label}</span></div>
    <DrawerSection title="Người yêu cầu"><Info label="Họ tên" value={row.user.fullName} /><Info label="Email" value={row.user.email} /><Info label="Điện thoại" value={row.user.phone || 'Chưa cập nhật'} /></DrawerSection>
    <DrawerSection title="Tài khoản nhận tiền"><Info label="Ngân hàng" value={row.bankName} /><Info label="Số tài khoản" value={row.bankAccountNumber} /><Info label="Chủ tài khoản" value={row.bankAccountName} /></DrawerSection>
    <DrawerSection title="Kiểm soát số dư"><Info label="Trước khi tạo lệnh" value={money.format(Number(row.balanceBeforeVnd))} /><Info label="Đã giữ cho lệnh rút" value={money.format(Number(row.amountVnd))} /><Info label="Còn lại" value={money.format(Number(row.balanceAfterVnd))} /></DrawerSection>
    {row.status === 'PENDING' ? <section className="withdrawal-review">
      <h3>Duyệt chuyển khoản</h3>
      <label>Mã giao dịch ngân hàng<input value={transactionCode} onChange={(event) => onTransactionCode(event.target.value)} placeholder="Ví dụ: ACB260907001" /></label>
      <label className="proof-upload"><span>Ảnh chuyển khoản thành công</span><span><ImagePlus size={18} />{proof ? proof.name : 'Chọn ảnh JPG, PNG hoặc WebP'}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onProof(event.target.files?.[0])} /></label>
      <label>Ghi chú<textarea value={reviewNote} onChange={(event) => onReviewNote(event.target.value)} placeholder="Ghi chú nội bộ (không bắt buộc)" /></label>
      <button className="primary-button" disabled={busy || !proof || transactionCode.trim().length < 3} onClick={onApprove}>Duyệt và xác nhận đã chuyển tiền</button>
      <div className="withdrawal-reject"><h3>Từ chối &amp; hoàn tiền</h3><label>Lý do từ chối<textarea value={rejectionReason} onChange={(event) => onRejectionReason(event.target.value)} placeholder="Lý do này sẽ được gửi cho user" /></label><button className="reject-button" disabled={busy || rejectionReason.trim().length < 3} onClick={onReject}>Từ chối và hoàn tiền</button></div>
    </section> : <section className="withdrawal-result">
      <h3>{row.status === 'APPROVED' ? 'Thông tin chuyển khoản' : 'Thông tin hoàn tiền'}</h3>
      <dl>{row.status === 'APPROVED' ? <><Info label="Mã giao dịch" value={row.bankTransactionCode || '—'} /><Info label="Ngày duyệt" value={row.reviewedAt ? dateTime.format(new Date(row.reviewedAt)) : '—'} /></> : <><Info label="Lý do" value={row.rejectionReason || row.reviewNote || '—'} /><Info label="Đã hoàn lúc" value={row.refundedAt ? dateTime.format(new Date(row.refundedAt)) : '—'} /></>}</dl>
      {row.status === 'APPROVED' && row.transferProof?.public_url ? <a className="proof-preview" href={row.transferProof.public_url} target="_blank" rel="noreferrer"><img src={row.transferProof.public_url} alt="Ảnh chuyển khoản thành công" /><span>Xem ảnh chuyển khoản</span></a> : null}
    </section>}
  </aside>;
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="drawer-section"><h3>{title}</h3><dl>{children}</dl></section>; }
function Info({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
