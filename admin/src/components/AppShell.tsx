import { Bell, Bot, ChevronDown, FileText, Home, Landmark, PanelLeftClose, ShieldCheck, Store, Users, WalletCards, Waypoints } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandMark } from './BrandMark';

export type RouteName = 'dashboard' | 'kyc' | 'agencies' | 'ai-experts' | 'accounts';

const nav = [
  { label: 'Tổng quan', icon: Home, route: 'dashboard' as RouteName },
  { label: 'Người dùng & KYC', icon: Users, route: 'kyc' as RouteName },
  { label: 'Đại lý', icon: Store, route: 'agencies' as RouteName },
  { label: 'AI chuyên gia', icon: Bot, route: 'ai-experts' as RouteName },
  { label: 'Nạp tiền', icon: WalletCards },
  { label: 'NFT', icon: Landmark },
  { label: 'Giao dịch', icon: Waypoints },
  { label: 'Tin tức', icon: FileText },
  { label: 'Phân quyền', icon: ShieldCheck, route: 'accounts' as RouteName },
];

const routeMeta: Record<RouteName, { title: string; description: string }> = {
  dashboard: { title: 'Tổng quan', description: 'Trung tâm vận hành Mindo' },
  kyc: { title: 'Người dùng & KYC', description: 'Xác minh hồ sơ khách hàng' },
  agencies: { title: 'Đại lý', description: 'Quản lý mạng lưới kinh doanh' },
  'ai-experts': { title: 'AI chuyên gia', description: 'Cấu hình trợ lý Mindo' },
  accounts: { title: 'Phân quyền', description: 'Quản trị tài khoản nội bộ' },
};

export function AppShell({ route, onNavigate, children }: { route: RouteName; onNavigate: (route: RouteName) => void; children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><BrandMark /><span className="brand-copy"><strong>Mindo</strong><small>Admin Portal</small></span></div>
        <nav aria-label="Điều hướng chính">
          {nav.map(({ label, icon: Icon, route: itemRoute }) => (
            <button key={label} className={itemRoute === route ? 'nav-item active' : 'nav-item'} onClick={() => itemRoute && onNavigate(itemRoute)} disabled={!itemRoute}>
              <Icon size={20} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="collapse"><PanelLeftClose size={18} /> Thu gọn</button>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-copy"><strong>{routeMeta[route].title}</strong><span>{routeMeta[route].description}</span></div>
          <div className="topbar-actions"><button className="notification-button" aria-label="Thông báo"><Bell size={19} /></button><div className="admin-profile"><span className="avatar">AD</span><span><strong>Admin</strong><small>Quản trị viên</small></span><ChevronDown size={16} /></div></div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
