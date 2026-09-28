import { Bell, Bot, ChevronDown, FileText, GitBranch, Home, Landmark, LogOut, PanelLeftClose, ShieldCheck, Store, Users, WalletCards, Waypoints } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { clearToken } from '../api';
import { BrandMark } from './BrandMark';

export type RouteName = 'dashboard' | 'kyc' | 'agencies' | 'referrals' | 'ai-experts' | 'deposits' | 'products' | 'transactions' | 'news' | 'accounts';

const nav = [
  { label: 'Tổng quan', icon: Home, route: 'dashboard' as RouteName },
  { label: 'Người dùng & KYC', icon: Users, route: 'kyc' as RouteName },
  { label: 'Đại lý', icon: Store, route: 'agencies' as RouteName },
  { label: 'Giới thiệu', icon: GitBranch, route: 'referrals' as RouteName },
  { label: 'AI chuyên gia', icon: Bot, route: 'ai-experts' as RouteName },
  { label: 'Nạp tiền', icon: WalletCards, route: 'deposits' as RouteName },
  { label: 'Sản phẩm Peer', icon: Landmark, route: 'products' as RouteName },
  { label: 'Giao dịch', icon: Waypoints, route: 'transactions' as RouteName },
  { label: 'Tin tức', icon: FileText, route: 'news' as RouteName },
  { label: 'Phân quyền', icon: ShieldCheck, route: 'accounts' as RouteName },
];

const routeMeta: Record<RouteName, { title: string; description: string }> = {
  dashboard: { title: 'Tổng quan', description: 'Trung tâm vận hành Mindo' },
  kyc: { title: 'Người dùng & KYC', description: 'Xác minh hồ sơ khách hàng' },
  agencies: { title: 'Đại lý', description: 'Quản lý mạng lưới kinh doanh' },
  referrals: { title: 'Hệ thống giới thiệu', description: 'Cấu hình thưởng và theo dõi đầu nhánh' },
  'ai-experts': { title: 'AI chuyên gia', description: 'Cấu hình trợ lý Mindo' },
  deposits: { title: 'Nạp tiền VietQR', description: 'Đối soát và ghi có tự động' },
  products: { title: 'Sản phẩm Peer', description: 'Nguồn cung và trạng thái mở bán' },
  transactions: { title: 'Giao dịch', description: 'Theo dõi đơn mua và Peer đã cấp' },
  news: { title: 'Trung tâm tin tức', description: 'Quản lý bài viết, Sóng và chuyên gia' },
  accounts: { title: 'Phân quyền', description: 'Quản trị tài khoản nội bộ' },
};

export function AppShell({ route, onNavigate, children }: { route: RouteName; onNavigate: (route: RouteName) => void; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
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
          <div className="topbar-actions"><button className="notification-button" aria-label="Thông báo"><Bell size={19} /></button><div className="admin-profile"><span className="avatar">AD</span><span><strong>Admin</strong><small>Quản trị viên</small></span><ChevronDown size={16} /></div><button className="logout-button" aria-label="Đăng xuất" onClick={() => { clearToken(); location.reload(); }}><LogOut size={18} /></button></div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
