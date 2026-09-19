import { useState } from 'react';
import { api, getToken, type KycRow } from './api';
import { AppShell, type RouteName } from './components/AppShell';
import { BrandMark } from './components/BrandMark';
import { DashboardPage } from './pages/DashboardPage';
import { KycDetailPage } from './pages/KycDetailPage';
import { AgenciesPage } from './pages/AgenciesPage';
import { AdminAccountsPage } from './pages/AdminAccountsPage';
import { AiExpertsPage } from './pages/AiExpertsPage';

export default function App() {
  const [route, setRoute] = useState<RouteName>('dashboard');
  const [selectedKyc, setSelectedKyc] = useState<KycRow>();
  const demo = import.meta.env.VITE_DEMO_MODE === 'true';
  if (!demo && !getToken()) return <Login />;
  let content: React.ReactNode;
  if (route === 'dashboard') content = <DashboardPage onOpenKyc={(kyc) => { setSelectedKyc(kyc); setRoute('kyc'); }} />;
  else if (route === 'kyc') content = <KycDetailPage row={selectedKyc} onBack={() => setRoute('dashboard')} />;
  else if (route === 'agencies') content = <AgenciesPage />;
  else if (route === 'ai-experts') content = <AiExpertsPage />;
  else content = <AdminAccountsPage />;
  return <AppShell route={route} onNavigate={setRoute}>{content}</AppShell>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try { await api.login(email, password); location.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Đăng nhập thất bại'); }
  }
  return <main className="login-page"><form onSubmit={(event) => void submit(event)}><div className="brand login-brand"><BrandMark /><strong>Mindo Admin</strong></div><h1>Đăng nhập quản trị</h1><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Mật khẩu<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>{error ? <p className="login-error">{error}</p> : null}<button className="primary-button">Đăng nhập</button></form></main>;
}
