import { HandCoins, Bell, Bot, ChartNoAxesCombined, CheckCircle2, ChevronDown, Eye, EyeOff, FileText, GitBranch, Home, KeyRound, Landmark, LogOut, PanelLeftClose, ShieldCheck, Store, Users, WalletCards, Waypoints, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, clearToken } from '../api';
import { BrandMark } from './BrandMark';

export type RouteName = 'dashboard' | 'analytics' | 'kyc' | 'agencies' | 'referrals' | 'ai-experts' | 'deposits' | 'withdrawals' | 'products' | 'transactions' | 'news' | 'accounts';

const nav = [
  { label: 'Tổng quan', icon: Home, route: 'dashboard' as RouteName },
  { label: 'Báo cáo & Thống kê', icon: ChartNoAxesCombined, route: 'analytics' as RouteName },
  { label: 'Người dùng & KYC', icon: Users, route: 'kyc' as RouteName },
  { label: 'Đại lý', icon: Store, route: 'agencies' as RouteName },
  { label: 'Giới thiệu', icon: GitBranch, route: 'referrals' as RouteName },
  { label: 'AI chuyên gia', icon: Bot, route: 'ai-experts' as RouteName },
  { label: 'Lịch sử nạp tiền', icon: WalletCards, route: 'deposits' as RouteName },
  { label: 'Lịch sử rút tiền', icon: HandCoins, route: 'withdrawals' as RouteName },
  { label: 'Sản phẩm Peer', icon: Landmark, route: 'products' as RouteName },
  { label: 'Giao dịch', icon: Waypoints, route: 'transactions' as RouteName },
  { label: 'Tin tức', icon: FileText, route: 'news' as RouteName },
  { label: 'Phân quyền', icon: ShieldCheck, route: 'accounts' as RouteName },
];

const routeMeta: Record<RouteName, { title: string; description: string }> = {
  dashboard: { title: 'Tổng quan', description: 'Trung tâm vận hành Mindo' },
  analytics: { title: 'Báo cáo & Thống kê', description: 'Phân tích kinh doanh và đối soát dòng tiền' },
  kyc: { title: 'Người dùng & KYC', description: 'Xác minh hồ sơ khách hàng' },
  agencies: { title: 'Đại lý', description: 'Quản lý mạng lưới kinh doanh' },
  referrals: { title: 'Hệ thống giới thiệu', description: 'Cấu hình thưởng và theo dõi đầu nhánh' },
  'ai-experts': { title: 'AI chuyên gia', description: 'Cấu hình trợ lý Mindo' },
  deposits: { title: 'Lịch sử nạp tiền', description: 'Đối soát và ghi có tự động qua VietQR' },
  withdrawals: { title: 'Lịch sử rút tiền', description: 'Duyệt chuyển khoản, từ chối và hoàn tiền' },
  products: { title: 'Sản phẩm Peer', description: 'Nguồn cung và trạng thái mở bán' },
  transactions: { title: 'Giao dịch', description: 'Theo dõi đơn mua và Peer đã cấp' },
  news: { title: 'Trung tâm tin tức', description: 'Quản lý bài viết, Sóng và chuyên gia' },
  accounts: { title: 'Phân quyền', description: 'Quản trị tài khoản nội bộ' },
};

export function AppShell({ route, onNavigate, children }: { route: RouteName; onNavigate: (route: RouteName) => void; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeAccountMenu(event: MouseEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setAccountMenuOpen(false);
      setPasswordDialogOpen(false);
    }
    document.addEventListener('mousedown', closeAccountMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeAccountMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.logout();
    } catch {
      // Dù API không còn nhận phiên, trình duyệt vẫn phải bỏ token cục bộ.
    } finally {
      clearToken();
      location.reload();
    }
  }

  return (
    <div className={collapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
      <aside className="sidebar">
        <div className="brand"><BrandMark /><span className="brand-copy"><strong>Mindo</strong><small>Admin Portal</small></span></div>
        <nav aria-label="Điều hướng chính">
          {nav.map(({ label, icon: Icon, route: itemRoute }) => (
            <button key={label} aria-label={label} className={itemRoute === route ? 'nav-item active' : 'nav-item'} onClick={() => itemRoute && onNavigate(itemRoute)} disabled={!itemRoute}>
              <Icon size={20} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="collapse" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}><PanelLeftClose size={18} /> <span>{collapsed ? 'Mở rộng' : 'Thu gọn'}</span></button>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-copy"><strong>{routeMeta[route].title}</strong><span>{routeMeta[route].description}</span></div>
          <div className="topbar-actions">
            <button className="notification-button" aria-label="Thông báo"><Bell size={19} /></button>
            <div className="account-menu" ref={accountMenuRef}>
              <button className="admin-profile" aria-label="Mở menu tài khoản" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((value) => !value)}>
                <span className="avatar">AD</span><span><strong>Admin</strong><small>Quản trị viên</small></span><ChevronDown className={accountMenuOpen ? 'chevron-open' : ''} size={17} />
              </button>
              {accountMenuOpen ? <div className="account-dropdown" role="menu">
                <button role="menuitem" onClick={() => { setAccountMenuOpen(false); setPasswordDialogOpen(true); }}><KeyRound size={17} /><span><strong>Đổi mật khẩu</strong><small>Cập nhật mật khẩu đăng nhập</small></span></button>
                <button className="account-logout" role="menuitem" disabled={loggingOut} onClick={() => void logout()}><LogOut size={17} /><span><strong>{loggingOut ? 'Đang đăng xuất...' : 'Đăng xuất'}</strong><small>Kết thúc phiên làm việc</small></span></button>
              </div> : null}
            </div>
          </div>
        </header>
        <main>{children}</main>
      </div>
      {passwordDialogOpen ? <ChangePasswordDialog onClose={() => setPasswordDialogOpen(false)} /> : null}
    </div>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visibleField, setVisibleField] = useState<'old' | 'new' | 'confirm' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (newPassword.length < 8) return setError('Mật khẩu mới phải có ít nhất 8 ký tự.');
    if (newPassword !== confirmPassword) return setError('Xác nhận mật khẩu không khớp.');
    if (newPassword === oldPassword) return setError('Mật khẩu mới phải khác mật khẩu hiện tại.');
    setSubmitting(true);
    try {
      await api.changePassword(oldPassword, newPassword, confirmPassword);
      clearToken();
      setChanged(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể đổi mật khẩu');
    } finally {
      setSubmitting(false);
    }
  }

  if (changed) return <div className="account-modal-backdrop" role="presentation">
    <section className="account-modal password-success" role="dialog" aria-modal="true" aria-labelledby="password-success-title">
      <span className="password-success-icon"><CheckCircle2 size={28} /></span>
      <h2 id="password-success-title">Đổi mật khẩu thành công</h2>
      <p>Để bảo vệ tài khoản, vui lòng đăng nhập lại bằng mật khẩu mới.</p>
      <button className="primary-button" onClick={() => location.reload()}>Đăng nhập lại</button>
    </section>
  </div>;

  const fields = [
    { id: 'old-password', key: 'old' as const, label: 'Mật khẩu hiện tại', value: oldPassword, setValue: setOldPassword, autoComplete: 'current-password' },
    { id: 'new-password', key: 'new' as const, label: 'Mật khẩu mới', value: newPassword, setValue: setNewPassword, autoComplete: 'new-password' },
    { id: 'confirm-password', key: 'confirm' as const, label: 'Xác nhận mật khẩu mới', value: confirmPassword, setValue: setConfirmPassword, autoComplete: 'new-password' },
  ];

  return <div className="account-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
      <header><span><h2 id="change-password-title">Đổi mật khẩu</h2><p>Sử dụng mật khẩu mạnh và không dùng lại mật khẩu cũ.</p></span><button type="button" aria-label="Đóng" onClick={onClose}><X size={19} /></button></header>
      <form onSubmit={(event) => void submit(event)}>
        {fields.map((field) => <label key={field.id} htmlFor={field.id}>{field.label}<span className="password-field"><KeyRound size={18} /><input id={field.id} type={visibleField === field.key ? 'text' : 'password'} value={field.value} onChange={(event) => field.setValue(event.target.value)} autoComplete={field.autoComplete} minLength={field.key === 'old' ? undefined : 8} required /><button type="button" aria-label={visibleField === field.key ? `Ẩn ${field.label.toLowerCase()}` : `Hiện ${field.label.toLowerCase()}`} onClick={() => setVisibleField((value) => value === field.key ? null : field.key)}>{visibleField === field.key ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>)}
        {error ? <p className="account-modal-error">{error}</p> : null}
        <footer><button type="button" className="outline-button" onClick={onClose}>Hủy</button><button className="primary-button" disabled={submitting}>{submitting ? 'Đang cập nhật...' : 'Đổi mật khẩu'}</button></footer>
      </form>
    </section>
  </div>;
}
