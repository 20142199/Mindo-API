import { BadgePercent, Box, CheckCircle2, CircleDollarSign, RefreshCw, Search, Waypoints, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type TransactionRow } from '../api';
import { statusDisplay } from '../status';

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
const tierLabels: Record<string, string> = { TIER_1: 'Đại lý Hoàng Kim', TIER_2: 'Đại lý Bạch Kim', TIER_3: 'Đại lý Kim Cương' };

export function TransactionsPage() {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [selected, setSelected] = useState<TransactionRow>();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try { const next = await api.transactions(); setRows(next); if (selected) setSelected(next.find((row) => row.id === selected.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải giao dịch'); }
  }
  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => rows.filter((row) => {
    const text = `${row.id} ${row.user.fullName} ${row.user.email} ${row.product?.name ?? ''} ${row.referralCode ?? ''}`.toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (status === 'ALL' || row.status === status);
  }), [rows, query, status]);
  const completed = rows.filter((row) => row.status === 'COMPLETED');
  const revenue = completed.reduce((sum, row) => sum + Number(row.totalVnd), 0);
  const discount = completed.reduce((sum, row) => sum + Number(row.discountVnd ?? 0), 0);
  const issued = completed.reduce((sum, row) => sum + row.quantity, 0);

  return <div className={selected ? 'page operations-page operations-drawer-open' : 'page operations-page'}>
    <section className="operations-main">
      <div className="page-title-row"><div><h1>Giao dịch mua Peer</h1><p>Theo dõi giá, chiết khấu, mã giới thiệu và tài sản đã cấp.</p></div><button className="outline-button" onClick={() => void load()}><RefreshCw size={17} /> Làm mới</button></div>
      {error ? <div className="error-banner">{error}</div> : null}
      <section className="metric-row">
        <Metric label="Tổng đơn" value={rows.length.toLocaleString('vi-VN')} icon={Waypoints} />
        <Metric label="Đơn hoàn tất" value={completed.length.toLocaleString('vi-VN')} icon={CheckCircle2} />
        <Metric label="Peer đã cấp" value={issued.toLocaleString('vi-VN')} icon={Box} />
        <Metric label="Doanh thu thực thu" value={money.format(revenue)} icon={CircleDollarSign} moneyValue />
      </section>
      <section className="transaction-highlight"><span><BadgePercent size={19} /><span><small>Tổng chiết khấu đã áp dụng</small><strong>{money.format(discount)}</strong></span></span><p>Đơn hoàn tất được cấp Peer nội bộ ngay trong cùng giao dịch; không có phí blockchain.</p></section>
      <section className="work-panel"><div className="filters compact-filters"><label className="search"><Search size={18} /><input aria-label="Tìm giao dịch" placeholder="Tìm mã đơn, người mua, sản phẩm hoặc mã ref" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="select-label"><span>Trạng thái</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Tất cả</option><option value="COMPLETED">Hoàn tất</option><option value="PENDING">Đang xử lý</option><option value="FAILED">Thất bại</option><option value="CANCELLED">Đã hủy</option></select></label></div><div className="table-heading"><h2>Danh sách giao dịch</h2></div><div className="table-scroll"><table><thead><tr><th>Mã đơn</th><th>Người mua</th><th>Sản phẩm</th><th>Số lượng</th><th>Chiết khấu</th><th>Thực trả</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
        {visible.map((row) => { const display = statusDisplay(row.status); return <tr key={row.id} className={selected?.id === row.id ? 'selected-row' : ''}><td><strong>TX#{row.id.slice(-8).toUpperCase()}</strong><small>{dateTime.format(new Date(row.createdAt))}</small></td><td><strong>{row.user.fullName}</strong><small>{row.user.email}</small></td><td><strong>{row.product?.name ?? 'Peer'}</strong><small>{row.product?.symbol ?? row.productId}</small></td><td>{row.quantity.toLocaleString('vi-VN')}</td><td>{money.format(Number(row.discountVnd ?? 0))}<small>{Number(row.effectiveDiscountRate ?? 0) * 100}%</small></td><td>{money.format(Number(row.totalVnd))}</td><td><span className={`status ${display.tone}`}>{display.label}</span></td><td><button className="text-button" onClick={() => setSelected(row)}>Xem chi tiết</button></td></tr>; })}
        {visible.length === 0 ? <tr><td colSpan={8} className="empty">Không có giao dịch phù hợp.</td></tr> : null}
      </tbody></table></div><footer className="table-footer"><span>Hiển thị <strong>{visible.length}</strong> / {rows.length} giao dịch</span></footer></section>
    </section>
    {selected ? <TransactionDrawer row={selected} onClose={() => setSelected(undefined)} /> : null}
  </div>;
}

function Metric({ label, value, icon: Icon, moneyValue }: { label: string; value: string; icon: typeof Waypoints; moneyValue?: boolean }) { return <div className="metric"><span className="metric-icon"><Icon /></span><span><small>{label}</small><strong className={moneyValue ? 'metric-money' : ''}>{value}</strong></span></div>; }

function TransactionDrawer({ row, onClose }: { row: TransactionRow; onClose: () => void }) {
  const display = statusDisplay(row.status);
  return <aside className="detail-drawer" aria-label="Chi tiết giao dịch"><header><h2>Chi tiết giao dịch</h2><button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={19} /></button></header><div className="drawer-hero"><span className="agency-logo"><Waypoints /></span><span><strong>TX#{row.id.slice(-8).toUpperCase()}</strong><small>{dateTime.format(new Date(row.createdAt))}</small></span><span className={`status ${display.tone}`}>{display.label}</span></div>
    <DrawerSection title="Người mua"><Info label="Họ tên" value={row.user.fullName} /><Info label="Email" value={row.user.email} /><Info label="Mã ref của user" value={row.user.referralCode || '—'} /><Info label="Mã dùng cho đơn" value={row.referralCode || 'Không sử dụng'} /></DrawerSection>
    <DrawerSection title="Sản phẩm"><Info label="Tên sản phẩm" value={row.product?.name ?? 'Peer'} /><Info label="Số lượng" value={`${row.quantity.toLocaleString('vi-VN')} Peer`} /><Info label="Danh hiệu đạt" value={row.agencyTitle ? tierLabels[row.agencyTitle] ?? row.agencyTitle : '—'} /><Info label="Tài sản đã cấp" value={`${row.nftAssets?.length ?? 0} Peer`} /></DrawerSection>
    <DrawerSection title="Giá trị đơn"><Info label="Giá niêm yết" value={money.format(Number(row.grossTotalVnd ?? row.totalVnd))} /><Info label="Chiết khấu" value={`${money.format(Number(row.discountVnd ?? 0))} (${Number(row.effectiveDiscountRate ?? 0) * 100}%)`} /><Info label="Thực trả" value={money.format(Number(row.totalVnd))} /><Info label="Tỷ giá" value={row.usdVndRate ? `${Number(row.usdVndRate).toLocaleString('vi-VN')} VND/USD` : '—'} /></DrawerSection>
    {row.nftAssets?.length ? <DrawerSection title="Peer đã cấp"><div className="asset-list">{row.nftAssets.slice(0, 20).map((asset) => <span key={asset.id}>{asset.assetCode}</span>)}{row.nftAssets.length > 20 ? <small>Và {row.nftAssets.length - 20} Peer khác</small> : null}</div></DrawerSection> : null}
  </aside>;
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="drawer-section"><h3>{title}</h3><dl>{children}</dl></section>; }
function Info({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
