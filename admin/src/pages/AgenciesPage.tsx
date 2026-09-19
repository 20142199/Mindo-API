import { Check, Clock3, Download, LockKeyhole, RefreshCw, Search, Store, TrendingUp, UsersRound, X } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { api, type AgencyRow, type AgencyStats, type AgencyStatus } from '../api';
import { statusDisplay } from '../status';

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const tierLabels: Record<string, string> = { TIER_1: 'Gói 1', TIER_2: 'Gói 2', TIER_3: 'Gói 3' };

export function AgenciesPage() {
  const [stats, setStats] = useState<AgencyStats>();
  const [rows, setRows] = useState<AgencyRow[]>([]);
  const [selected, setSelected] = useState<AgencyRow>();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setError('');
    try {
      const [nextStats, nextRows] = await Promise.all([api.agencyStats(), api.agencies(deferredQuery, status)]);
      setStats(nextStats);
      setRows(nextRows);
      if (selected) {
        const refreshed = nextRows.find((row) => row.id === selected.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu đại lý'); }
  }

  useEffect(() => { void load(); }, [deferredQuery, status]);

  const visibleRows = useMemo(() => rows.filter((row) => !tier || row.active_package?.tier === tier), [rows, tier]);
  const cards = [
    { label: 'Chờ duyệt', value: stats?.pending ?? '—', icon: Clock3 },
    { label: 'Đang hoạt động', value: stats?.active ?? '—', icon: UsersRound },
    { label: 'Doanh số tháng', value: stats ? money.format(Number(stats.month_revenue_vnd)) : '—', icon: TrendingUp },
    { label: 'Hoa hồng tháng', value: stats ? money.format(Number(stats.month_commission_vnd)) : '—', icon: Store },
  ];

  async function openDetail(row: AgencyRow) {
    setSelected(row);
    try { setSelected(await api.agencyDetail(row.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải chi tiết đại lý'); }
  }

  async function review(nextStatus: AgencyStatus) {
    if (!selected) return;
    if (nextStatus === 'REJECTED' && !note.trim()) { setError('Vui lòng nhập lý do từ chối.'); return; }
    setBusy(true); setError('');
    try {
      await api.reviewAgency(selected.id, nextStatus, note);
      const detail = await api.agencyDetail(selected.id);
      setSelected({ ...detail, status: nextStatus });
      setNote('');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể cập nhật đại lý'); }
    finally { setBusy(false); }
  }

  return <div className={selected ? 'page agency-page drawer-open' : 'page agency-page'}>
    <section className="agency-main">
      <h1>Quản lý đại lý</h1>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="metric-row agency-metrics">{cards.map(({ label, value, icon: Icon }) => <div className="metric" key={label}><span className="metric-icon"><Icon /></span><span><small>{label}</small><strong className="metric-money">{typeof value === 'number' ? value.toLocaleString('vi-VN') : value}</strong></span></div>)}</div>
      <section className="work-panel">
        <div className="filters agency-filters">
          <label className="search"><Search size={18} /><input aria-label="Tìm đại lý" placeholder="Tìm tên, email hoặc mã đại lý" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="select-label"><span>Trạng thái</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tất cả</option><option value="PENDING">Chờ duyệt</option><option value="APPROVED">Hoạt động</option><option value="LOCKED">Đã khóa</option><option value="REJECTED">Đã từ chối</option></select></label>
          <label className="select-label"><span>Gói</span><select value={tier} onChange={(event) => setTier(event.target.value)}><option value="">Tất cả</option><option value="TIER_1">Gói 1</option><option value="TIER_2">Gói 2</option><option value="TIER_3">Gói 3</option></select></label>
          <button className="outline-button" onClick={() => void load()}><RefreshCw size={17} /> Làm mới</button>
        </div>
        <div className="table-heading"><h2>Danh sách đại lý</h2></div>
        <div className="table-scroll"><table><thead><tr><th>Đại lý</th><th>Mã</th><th>Gói hiện tại</th><th>Doanh số</th><th>Hoa hồng</th><th>Cấp dưới</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
          {visibleRows.map((row) => <AgencyTableRow key={row.id} row={row} selected={row.id === selected?.id} onOpen={openDetail} />)}
          {visibleRows.length === 0 ? <tr><td colSpan={8} className="empty">Không có đại lý phù hợp.</td></tr> : null}
        </tbody></table></div>
        <footer className="table-footer"><span>Hiển thị <strong>{visibleRows.length}</strong> đại lý</span><span className="pagination"><button disabled>‹</button><button className="current">1</button><button disabled>›</button></span></footer>
      </section>
    </section>
    {selected ? <AgencyDrawer agency={selected} note={note} busy={busy} onNote={setNote} onClose={() => setSelected(undefined)} onReview={review} onContract={() => void api.downloadAgencyContract(selected.id)} /> : null}
  </div>;
}

function AgencyTableRow({ row, selected, onOpen }: { row: AgencyRow; selected: boolean; onOpen: (row: AgencyRow) => void }) {
  const status = statusDisplay(row.status);
  return <tr className={selected ? 'selected-row' : ''}><td><span className="entity-cell"><span className="row-icon"><Store size={16} /></span><span><strong>{row.user.fullName}</strong><small>{row.user.email}</small></span></span></td><td>{row.code}</td><td>{row.active_package ? tierLabels[row.active_package.tier] : 'Chưa có'}</td><td>{money.format(Number(row.totalRevenueVnd))}</td><td>{money.format(Number(row.totalCommissionVnd))}</td><td>{row.child_count}</td><td><span className={`status ${status.tone}`}>{status.label}</span></td><td><button className="text-button" onClick={() => void onOpen(row)}>Xem chi tiết</button></td></tr>;
}

function AgencyDrawer({ agency, note, busy, onNote, onClose, onReview, onContract }: { agency: AgencyRow; note: string; busy: boolean; onNote: (value: string) => void; onClose: () => void; onReview: (status: AgencyStatus) => void; onContract: () => void }) {
  const status = statusDisplay(agency.status);
  return <aside className="detail-drawer" aria-label="Chi tiết đại lý">
    <header><h2>Chi tiết đại lý</h2><button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={19} /></button></header>
    <div className="agency-identity"><span className="agency-logo"><Store /></span><span><strong>{agency.user.fullName}</strong><small>Mã đại lý: {agency.code}</small><small>{agency.user.email}</small><span className={`status ${status.tone}`}>{status.label}</span></span></div>
    <div className="drawer-actions"><button className="primary-button" disabled={busy || agency.status === 'APPROVED'} onClick={() => onReview('APPROVED')}><Check size={16} /> Phê duyệt</button><button className="outline-button" disabled={busy} onClick={() => onReview('REJECTED')}><X size={16} /> Từ chối</button><button className="outline-button" disabled={busy || agency.status === 'LOCKED'} onClick={() => onReview('LOCKED')}><LockKeyhole size={16} /> Khóa</button></div>
    <DrawerSection title="Thông tin đại lý"><Info label="Tên kinh doanh" value={agency.businessName} /><Info label="Số điện thoại" value={agency.phone} /><Info label="Mã số thuế" value={agency.taxCode || 'Chưa cung cấp'} /><Info label="Địa chỉ" value={agency.address} /></DrawerSection>
    <DrawerSection title="Cửa hàng riêng"><Info label="Tên cửa hàng" value={agency.store?.name || 'Chưa cấu hình'} /><Info label="Đường dẫn" value={agency.store ? `/agency/${agency.store.slug}` : '—'} /><Info label="Trạng thái" value={agency.store?.isActive ? 'Đang hoạt động' : 'Chưa kích hoạt'} /></DrawerSection>
    <DrawerSection title="Gói NFT"><Info label="Gói hiện tại" value={agency.active_package ? tierLabels[agency.active_package.tier] : 'Chưa mua gói'} /><Info label="Suất còn lại" value={agency.active_package ? `${agency.active_package.remainingCommissionSlots}/${agency.active_package.quantity}` : '—'} /><Info label="Tỷ lệ" value={agency.active_package ? `${Number(agency.active_package.discountRate) * 100}%` : '—'} /></DrawerSection>
    <DrawerSection title="Tuyến trên"><Info label="Đại lý trực tiếp" value={agency.parent ? `${agency.parent.user.fullName} (${agency.parent.code})` : 'Đại lý gốc'} /><div className="tree-preview"><span>{agency.parent?.code ?? 'MINDO'}</span><i /><span>{agency.code}</span><small>{agency.child_count} đại lý cấp dưới</small></div></DrawerSection>
    <DrawerSection title="Hợp đồng"><Info label="Số hợp đồng" value={agency.contract?.contractNumber || 'Chưa phát hành'} />{agency.contract ? <button className="outline-button contract-button" onClick={onContract}><Download size={16} /> Tải hợp đồng</button> : null}</DrawerSection>
    <label className="drawer-note">Ghi chú xử lý<textarea value={note} onChange={(event) => onNote(event.target.value)} placeholder="Nhập ghi chú hoặc lý do từ chối..." /></label>
  </aside>;
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="drawer-section"><h3>{title}</h3><dl>{children}</dl></section>; }
function Info({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
