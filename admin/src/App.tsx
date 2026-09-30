import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, AUTH_EXPIRED_EVENT, consumeAuthNotice, expireSession, getToken, type KycRow } from './api';
import { isTokenExpired, tokenExpiresAt } from './auth-session';
import { AppShell, type RouteName } from './components/AppShell';
import { BrandMark } from './components/BrandMark';
import { DashboardPage } from './pages/DashboardPage';
import { KycDetailPage } from './pages/KycDetailPage';
import { AgenciesPage } from './pages/AgenciesPage';
import { AdminAccountsPage } from './pages/AdminAccountsPage';
import { AiExpertsPage } from './pages/AiExpertsPage';
import { ReferralsPage } from './pages/ReferralsPage';
import { NewsPage } from './pages/NewsPage';
import { KycListPage } from './pages/KycListPage';
import { DepositsPage } from './pages/DepositsPage';
import { ProductsPage } from './pages/ProductsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { WithdrawalsPage } from './pages/WithdrawalsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { pathForRoute, routeFromPath } from './routing';

export default function App() {
  const [route, setRoute] = useState<RouteName>(() => routeFromPath(location.pathname));
  const [selectedKyc, setSelectedKyc] = useState<KycRow>();
  const demo = import.meta.env.VITE_DEMO_MODE === 'true';
  const [authToken, setAuthToken] = useState(() => {
    const token = getToken();
    if (token && isTokenExpired(token)) {
      expireSession();
      return null;
    }
    return token;
  });
  useEffect(() => {
    const signOutExpiredSession = () => setAuthToken(null);
    addEventListener(AUTH_EXPIRED_EVENT, signOutExpiredSession);
    return () => removeEventListener(AUTH_EXPIRED_EVENT, signOutExpiredSession);
  }, []);

  useEffect(() => {
    const initialRoute = routeFromPath(location.pathname);
    const canonicalPath = pathForRoute(initialRoute);
    if (location.pathname !== canonicalPath) history.replaceState({}, '', canonicalPath);
    const syncFromBrowser = () => {
      setSelectedKyc(undefined);
      setRoute(routeFromPath(location.pathname));
    };
    addEventListener('popstate', syncFromBrowser);
    return () => removeEventListener('popstate', syncFromBrowser);
  }, []);

  useEffect(() => {
    if (demo || !authToken) return;
    const expiresAt = tokenExpiresAt(authToken);
    if (expiresAt === undefined) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      expireSession();
      return;
    }
    const timer = setTimeout(() => {
      expireSession();
    }, remaining);
    return () => clearTimeout(timer);
  }, [authToken, demo]);

  function navigate(nextRoute: RouteName) {
    if (nextRoute === 'kyc') setSelectedKyc(undefined);
    const nextPath = pathForRoute(nextRoute);
    if (location.pathname !== nextPath) history.pushState({}, '', nextPath);
    setRoute(nextRoute);
  }

  if (!demo && !authToken) return <Login />;
  let content: React.ReactNode;
  if (route === 'dashboard') content = <DashboardPage onOpenKyc={(kyc) => { setSelectedKyc(kyc); history.pushState({}, '', pathForRoute('kyc')); setRoute('kyc'); }} onNavigate={navigate} />;
  else if (route === 'analytics') content = <AnalyticsPage />;
  else if (route === 'kyc') content = selectedKyc
    ? <KycDetailPage row={selectedKyc} onBack={() => setSelectedKyc(undefined)} />
    : <KycListPage onOpen={setSelectedKyc} />;
  else if (route === 'agencies') content = <AgenciesPage />;
  else if (route === 'referrals') content = <ReferralsPage />;
  else if (route === 'ai-experts') content = <AiExpertsPage />;
  else if (route === 'news') content = <NewsPage />;
  else if (route === 'deposits') content = <DepositsPage />;
  else if (route === 'withdrawals') content = <WithdrawalsPage />;
  else if (route === 'products') content = <ProductsPage />;
  else if (route === 'transactions') content = <TransactionsPage />;
  else content = <AdminAccountsPage />;
  return <AppShell route={route} onNavigate={navigate}>{content}</AppShell>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(() => consumeAuthNotice());
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
