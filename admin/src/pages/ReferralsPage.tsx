import { BadgePercent, Check, Clipboard, GitBranch, Plus, RefreshCw, TrendingUp, UserCheck, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type ReferralSettings, type SystemReferralCodeRow } from '../api';

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });

export function ReferralsPage() {
  const [settings, setSettings] = useState<ReferralSettings>();
  const [directRate, setDirectRate] = useState('10');
  const [branchRate, setBranchRate] = useState('5');
  const [codes, setCodes] = useState<SystemReferralCodeRow[]>([]);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setError('');
    try {
      const [nextSettings, nextCodes] = await Promise.all([api.referralSettings(), api.systemReferralCodes()]);
      setSettings(nextSettings);
      setDirectRate(String(nextSettings.direct_rate_percent));
      setBranchRate(String(nextSettings.branch_rate_percent));
      setCodes(nextCodes);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu giới thiệu'); }
  }

  useEffect(() => { void load(); }, []);

  const metrics = useMemo(() => ({
    total: codes.length,
    claimed: codes.filter((row) => row.claimedBy).length,
    members: codes.reduce((sum, row) => sum + row.downline_count, 0),
    sales: codes.reduce((sum, row) => sum + Number(row.downline_sales_vnd), 0),
  }), [codes]);

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    const direct = Number(directRate);
    const branch = Number(branchRate);
    if (!Number.isFinite(direct) || !Number.isFinite(branch) || direct < 0 || direct > 100 || branch < 0 || branch > 100) {
      setError('Tỷ lệ phải nằm trong khoảng 0–100%.'); return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await api.updateReferralSettings(direct, branch);
      setSettings(updated);
      setMessage('Đã cập nhật tỷ lệ thưởng. Các đơn mới sẽ áp dụng cấu hình này.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu cấu hình'); }
    finally { setBusy(false); }
  }

  async function createCode(event: React.FormEvent) {
    event.preventDefault();
    if (label.trim().length < 2) { setError('Vui lòng nhập tên hoặc ghi chú cho đầu nhánh.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const created = await api.createSystemReferralCode(label.trim());
      setLabel('');
      setMessage(`Đã tạo mã ${created.code}.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tạo mã'); }
    finally { setBusy(false); }
  }

  async function toggle(row: SystemReferralCodeRow) {
    setBusy(true); setError(''); setMessage('');
    try { await api.setSystemReferralCodeActive(row.id, !row.isActive); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể cập nhật mã'); }
    finally { setBusy(false); }
  }

  async function copy(code: string) {
    await navigator.clipboard.writeText(code);
    setMessage(`Đã sao chép mã ${code}.`);
  }

  const cards = [
    { label: 'Mã đầu nhánh', value: metrics.total, icon: GitBranch },
    { label: 'Đã được sử dụng', value: metrics.claimed, icon: UserCheck },
    { label: 'Tài khoản tuyến dưới', value: metrics.members, icon: UsersRound },
    { label: 'Tổng doanh số cây', value: money.format(metrics.sales), icon: TrendingUp },
  ];

  return <div className="page referral-page">
    <div className="page-title-row"><div><h1>Hệ thống giới thiệu</h1><p>Quản lý chính sách thưởng F0/F1 và các tài khoản đứng đầu nhánh.</p></div><button className="outline-button" onClick={() => void load()}><RefreshCw size={17} /> Làm mới</button></div>
    {error ? <div className="error-banner">{error}</div> : null}
    {message ? <div className="success-banner"><Check size={16} />{message}</div> : null}
    <div className="metric-row referral-metrics">{cards.map(({ label: cardLabel, value, icon: Icon }) => <div className="metric" key={cardLabel}><span className="metric-icon"><Icon /></span><span><small>{cardLabel}</small><strong className="metric-money">{typeof value === 'number' ? value.toLocaleString('vi-VN') : value}</strong></span></div>)}</div>

    <div className="referral-config-grid">
      <form className="work-panel referral-config-card" onSubmit={(event) => void saveSettings(event)}>
        <div className="panel-title"><span className="panel-title-icon"><BadgePercent size={20} /></span><div><h2>Tỷ lệ trả thưởng</h2><p>Áp dụng cho các giao dịch mua sản phẩm hoàn tất sau khi lưu.</p></div></div>
        <div className="rate-fields">
          <label><span>Thưởng giới thiệu trực tiếp F0</span><span className="percent-input"><input type="number" min="0" max="100" step="0.01" value={directRate} onChange={(event) => setDirectRate(event.target.value)} /><b>%</b></span><small>F1 mua sản phẩm, F0 nhận tỷ lệ này.</small></label>
          <label><span>Thưởng tổng doanh số đầu nhánh</span><span className="percent-input"><input type="number" min="0" max="100" step="0.01" value={branchRate} onChange={(event) => setBranchRate(event.target.value)} /><b>%</b></span><small>Đầu nhánh nhận trên mọi đơn của cây bên dưới.</small></label>
        </div>
        <button className="primary-button" disabled={busy}>Lưu tỷ lệ</button>
        {settings ? <small className="updated-note">Cấu hình hiện tại: {settings.direct_rate_percent}% trực tiếp · {settings.branch_rate_percent}% đầu nhánh</small> : null}
      </form>

      <form className="work-panel referral-config-card" onSubmit={(event) => void createCode(event)}>
        <div className="panel-title"><span className="panel-title-icon"><Plus size={20} /></span><div><h2>Tạo mã đầu nhánh</h2><p>Mỗi mã chỉ dùng một lần để đăng ký một tài khoản quan trọng.</p></div></div>
        <label className="system-code-label"><span>Tên / ghi chú đầu nhánh</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ví dụ: Đối tác miền Nam" maxLength={120} /></label>
        <button className="primary-button" disabled={busy}><Plus size={16} /> Tạo mã tự động</button>
      </form>
    </div>

    <section className="work-panel referral-table-panel">
      <div className="table-heading"><div><h2>Danh sách đầu nhánh</h2><p>Mã chưa dùng có thể gửi cho tài khoản quan trọng khi đăng ký.</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>Mã hệ thống</th><th>Tài khoản đầu nhánh</th><th>Tuyến dưới</th><th>Doanh số cây</th><th>Thưởng đầu nhánh</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
        {codes.map((row) => <tr key={row.id}>
          <td><span className="code-cell"><strong>{row.code}</strong><small>{row.label || 'Không có ghi chú'}</small></span></td>
          <td>{row.claimedBy ? <><strong>{row.claimedBy.fullName}</strong><small>{row.claimedBy.email}</small></> : <span className="muted-cell">Chưa có tài khoản</span>}</td>
          <td>{row.downline_count.toLocaleString('vi-VN')}</td>
          <td>{money.format(Number(row.downline_sales_vnd))}</td>
          <td>{money.format(Number(row.branch_commission_vnd))}</td>
          <td><span className={`status ${row.claimedBy ? 'success' : row.isActive ? 'warning' : 'danger'}`}>{row.claimedBy ? 'Đã sử dụng' : row.isActive ? 'Sẵn sàng' : 'Đã tắt'}</span></td>
          <td><span className="row-actions"><button className="text-button" onClick={() => void copy(row.code)}><Clipboard size={14} /> Sao chép</button>{!row.claimedBy ? <button className="text-button" disabled={busy} onClick={() => void toggle(row)}>{row.isActive ? 'Tắt mã' : 'Bật mã'}</button> : null}</span></td>
        </tr>)}
        {codes.length === 0 ? <tr><td colSpan={7} className="empty">Chưa có mã đầu nhánh. Tạo mã đầu tiên ở phía trên.</td></tr> : null}
      </tbody></table></div>
      <footer className="table-footer"><span>Tổng cộng <strong>{codes.length}</strong> mã hệ thống</span></footer>
    </section>
  </div>;
}
