import { RefreshCw, Search, ShieldCheck, UserCheck, UserRoundX, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type InvestorRow, type KycRow } from '../api';
import { statusDisplay } from '../status';

const dateTime = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
const agencyTierLabels: Record<string, string> = {
  TIER_1: 'Đại lý Hoàng Kim',
  TIER_2: 'Đại lý Bạch Kim',
  TIER_3: 'Đại lý Kim Cương',
};

export function KycListPage({ onOpen }: { onOpen: (row: KycRow) => void }) {
  const [rows, setRows] = useState<KycRow[]>([]);
  const [users, setUsers] = useState<InvestorRow[]>([]);
  const [tab, setTab] = useState<'kyc' | 'users'>('kyc');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try { const [nextRows, nextUsers] = await Promise.all([api.kyc(), api.users()]); setRows(nextRows); setUsers(nextUsers); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải hồ sơ KYC'); }
  }

  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => rows.filter((row) => {
    const text = `${row.fullName} ${row.user.email} ${row.phoneNumber} ${row.idCardNumber ?? ''}`.toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (status === 'ALL' || row.status === status);
  }), [rows, query, status]);
  const visibleUsers = useMemo(() => users.filter((user) => `${user.full_name} ${user.email} ${user.phone} ${user.referral_code}`.toLowerCase().includes(query.trim().toLowerCase())), [users, query]);
  const pending = rows.filter((row) => row.status === 'PENDING').length;
  const approved = rows.filter((row) => row.status === 'APPROVED').length;
  const rejected = rows.filter((row) => row.status === 'REJECTED').length;

  return <div className="page operations-page">
    <div className="page-title-row"><div><h1>Người dùng &amp; KYC</h1><p>Duyệt thủ công thông tin và giấy tờ khách hàng gửi từ ứng dụng.</p></div><button className="outline-button" onClick={() => void load()}><RefreshCw size={17} /> Làm mới</button></div>
    {error ? <div className="error-banner">{error}</div> : null}
    <section className="metric-row">
      <Metric label="Tổng người dùng" value={users.length} icon={UsersRound} />
      <Metric label="Chờ duyệt" value={pending} icon={ShieldCheck} />
      <Metric label="Đã xác minh" value={approved} icon={UserCheck} />
      <Metric label="Đã từ chối" value={rejected} icon={UserRoundX} />
    </section>
    <div className="news-tabs section-tabs"><button className={tab === 'kyc' ? 'active' : ''} onClick={() => setTab('kyc')}>Hồ sơ KYC</button><button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Tất cả người dùng</button></div>
    <section className="work-panel">
      <div className="filters compact-filters">
        <label className="search"><Search size={18} /><input aria-label="Tìm hồ sơ" placeholder={tab === 'kyc' ? 'Tìm tên, email, CCCD hoặc số điện thoại' : 'Tìm tên, email, điện thoại hoặc mã ref'} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {tab === 'kyc' ? <label className="select-label"><span>Trạng thái</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Tất cả</option><option value="PENDING">Chờ duyệt</option><option value="APPROVED">Đã duyệt</option><option value="REJECTED">Đã từ chối</option></select></label> : <span />}
      </div>
      <div className="table-heading"><h2>{tab === 'kyc' ? 'Danh sách hồ sơ' : 'Danh sách người dùng'}</h2></div>
      {tab === 'kyc' ? <><div className="table-scroll"><table><thead><tr><th>Khách hàng</th><th>Số điện thoại</th><th>Giấy tờ</th><th>Trạng thái</th><th>Ngày gửi</th><th>Thao tác</th></tr></thead><tbody>
        {visible.map((row) => { const display = statusDisplay(row.status); return <tr key={row.id}><td><strong>{row.fullName}</strong><small>{row.user.email}</small></td><td>{row.phoneNumber}</td><td>{row.idCardNumber || 'Chưa cung cấp'}</td><td><span className={`status ${display.tone}`}>{display.label}</span></td><td>{dateTime.format(new Date(row.createdAt))}</td><td><button className="text-button" onClick={() => onOpen(row)}>Xem hồ sơ</button></td></tr>; })}
        {visible.length === 0 ? <tr><td className="empty" colSpan={6}>Không có hồ sơ phù hợp.</td></tr> : null}
      </tbody></table></div><footer className="table-footer"><span>Hiển thị <strong>{visible.length}</strong> / {rows.length} hồ sơ</span></footer></> : <><div className="table-scroll"><table><thead><tr><th>Người dùng</th><th>Điện thoại</th><th>Mã giới thiệu</th><th>KYC</th><th>Danh hiệu</th><th>Số dư</th><th>Ngày tạo</th></tr></thead><tbody>{visibleUsers.map((user) => <tr key={user.id}><td><strong>{user.full_name}</strong><small>{user.email}</small></td><td>{user.phone || 'Chưa cập nhật'}</td><td>{user.referral_code}</td><td><span className={`status ${user.kyc_status === 'approved' ? 'success' : 'warning'}`}>{user.kyc_status === 'approved' ? 'Đã xác minh' : 'Chưa xác minh'}</span></td><td>{agencyTierLabels[user.agency_title || ''] || user.agency_title || 'Chưa có'}<small>{user.total_packages_purchased.toLocaleString('vi-VN')} Peer</small></td><td>{Number(user.balance_vnd).toLocaleString('vi-VN')} ₫</td><td>{dateTime.format(new Date(user.created_at))}</td></tr>)}{visibleUsers.length === 0 ? <tr><td className="empty" colSpan={7}>Không có người dùng phù hợp.</td></tr> : null}</tbody></table></div><footer className="table-footer"><span>Hiển thị <strong>{visibleUsers.length}</strong> / {users.length} người dùng</span></footer></>}
    </section>
  </div>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof UsersRound }) {
  return <div className="metric"><span className="metric-icon"><Icon /></span><span><small>{label}</small><strong>{value.toLocaleString('vi-VN')}</strong></span></div>;
}
