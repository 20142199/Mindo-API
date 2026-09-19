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

export function AppShell({ route, onNavigate, children }: { route: RouteName; onNavigate: (route: RouteName) => void; children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><BrandMark /><strong>Mindo Admin</strong></div>
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
          <span />
          <div className="admin-profile"><Bell size={20} /><span className="avatar">AD</span><span><strong>Admin</strong><small>Quản trị viên</small></span><ChevronDown size={16} /></div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
