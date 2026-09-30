import type { RouteName } from './components/AppShell';

export const routePaths: Record<RouteName, string> = {
  dashboard: '/',
  analytics: '/analytics',
  kyc: '/kyc',
  agencies: '/agencies',
  referrals: '/referrals',
  'ai-experts': '/ai-experts',
  deposits: '/deposits',
  withdrawals: '/withdrawals',
  products: '/products',
  transactions: '/transactions',
  news: '/news',
  accounts: '/accounts',
};

const routesByPath = new Map(Object.entries(routePaths).map(([route, path]) => [path, route as RouteName]));

export function pathForRoute(route: RouteName) {
  return routePaths[route];
}

export function routeFromPath(pathname: string): RouteName {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
  return routesByPath.get(normalized) ?? 'dashboard';
}
