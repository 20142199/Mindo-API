import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useState } from 'react';
import { api, getToken, type KycRow } from './api';
import { AppShell, type RouteName } from './components/AppShell';
import { BrandMark } from './components/BrandMark';
import { DashboardPage } from './pages/DashboardPage';
import { KycDetailPage } from './pages/KycDetailPage';
import { AgenciesPage } from './pages/AgenciesPage';
import { AdminAccountsPage } from './pages/AdminAccountsPage';
import { AiExpertsPage } from './pages/AiExpertsPage';
import { ReferralsPage } from './pages/ReferralsPage';

export default function App() {
  const [route, setRoute] = useState<RouteName>('dashboard');
  const [selectedKyc, setSelectedKyc] = useState<KycRow>();
  const demo = import.meta.env.VITE_DEMO_MODE === 'true';
  if (!demo && !getToken()) return <Login />;
  let content: React.ReactNode;
  if (route === 'dashboard') content = <DashboardPage onOpenKyc={(kyc) => { setSelectedKyc(kyc); setRoute('kyc'); }} />;
  else if (route === 'kyc') content = <KycDetailPage row={selectedKyc} onBack={() => setRoute('dashboard')} />;
  else if (route === 'agencies') content = <AgenciesPage />;
  else if (route === 'referrals') content = <ReferralsPage />;
  else if (route === 'ai-experts') content = <AiExpertsPage />;
  else content = <AdminAccountsPage />;
  return <AppShell route={route} onNavigate={setRoute}>{content}</AppShell>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try { await api.login(email, password); location.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Đăng nhập thất bại'); }
  }
  return <main className="login-page">
    <section className="login-intro">
      <div className="brand login-intro-brand"><BrandMark /><span className="brand-copy"><strong>Mindo</strong><small>Admin Portal</small></span></div>
      <div className="login-intro-copy"><h2>Vận hành Mindo<br />trong một không gian.</h2><p>Quản lý hồ sơ KYC, đại lý, giao dịch và toàn bộ hoạt động nền tảng một cách rõ ràng.</p><span className="login-accent" /></div>
      <p className="login-security">Hệ thống dành riêng cho đội ngũ vận hành Mindo.</p>
    </section>
    <section className="login-panel">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <div className="brand login-mobile-brand"><BrandMark /><strong>Mindo</strong></div>
        <div className="login-heading"><h1>Chào mừng trở lại.</h1><p>Đăng nhập để tiếp tục quản trị Mindo.</p><span /></div>
        <label>Email<span className="login-input"><Mail size={21} /><input type="email" placeholder="Nhập email của bạn" value={email} onChange={(event) => setEmail(event.target.value)} required /></span></label>
        <label>Mật khẩu<span className="login-input"><LockKeyhole size={21} /><input type={showPassword ? 'text' : 'password'} placeholder="Nhập mật khẩu" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></span></label>
        {error ? <p className="login-error">{error}</p> : null}
        <button className="primary-button login-submit">Đăng nhập <ArrowRight size={18} /></button>
      </form>
    </section>
  </main>;
}
