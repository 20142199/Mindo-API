export type DashboardMetrics = {
  kyc_pending: number;
  deposits_pending: number;
  nft_sold: number;
  transactions_need_review: number;
};

export type KycRow = {
  id: string;
  fullName: string;
  dateOfBirth: string;
  idCardNumber: string;
  phoneNumber: string;
  address: string;
  idFrontFileUrl: string;
  idBackFileUrl: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  user: { email: string; fullName: string };
};

export type DepositRow = {
  id: string;
  amountVnd: string;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  createdAt: string;
  user: { email: string; fullName: string };
};

export type TransactionRow = {
  id: string;
  totalVnd: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  createdAt: string;
  user: { email: string; fullName: string };
};

export type AgencyStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'LOCKED';
export type AgencyRow = {
  id: string;
  code: string;
  businessName: string;
  taxCode?: string;
  phone: string;
  address: string;
  status: AgencyStatus;
  totalRevenueVnd: string;
  totalCommissionVnd: string;
  child_count: number;
  createdAt: string;
  user: { id: string; fullName: string; email: string; phone?: string; referralCode: string };
  store?: { id: string; slug: string; name: string; isActive: boolean };
  parent?: { code: string; user: { fullName: string; email: string } };
  active_package?: { id: string; tier: string; quantity: number; remainingCommissionSlots: number; discountRate: string; product: { name: string } };
  contract?: { contractNumber: string; issuedAt: string };
  recent_orders?: TransactionRow[];
  recent_commissions?: Array<{ id: string; amountVnd: string; rate: string; createdAt: string; buyer: { fullName: string; email: string } }>;
};

export type AgencyStats = { pending: number; active: number; month_revenue_vnd: string; month_commission_vnd: string };
export type AdminAccount = {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'compliance' | 'finance';
  status: string;
  created_at: number;
};
export type AiExpert = {
  id: string;
  name: string;
  slug: string;
  specialty: string;
  description: string;
  systemPrompt: string;
  avatarUrl?: string;
  capabilities: string[];
  isActive: boolean;
};

type ApiEnvelope<T> = { data: T; message: string };
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';

const demoKyc: KycRow = {
  id: 'demo-kyc-1',
  fullName: 'Nguyễn Minh Anh',
  dateOfBirth: '1995-08-12T00:00:00.000Z',
  idCardNumber: '036095012345',
  phoneNumber: '0987 654 321',
  address: '123 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh',
  idFrontFileUrl: '',
  idBackFileUrl: '',
  status: 'PENDING',
  createdAt: '2026-09-07T03:23:00.000Z',
  user: { email: 'minhanh.nguyen95@gmail.com', fullName: 'Nguyễn Minh Anh' },
};

const demoAgencies: AgencyRow[] = [
  { id: 'a1', code: 'DL000128', businessName: 'Lộc Store', phone: '0988123456', address: '123 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh', taxCode: '0123456789-001', status: 'PENDING', totalRevenueVnd: '320000000', totalCommissionVnd: '32050000', child_count: 12, createdAt: '2026-09-07T02:15:00.000Z', user: { id: 'u1', fullName: 'Nguyễn Văn Lộc', email: 'loc.nguyen@example.com', referralCode: 'REFLOC' }, store: { id: 's1', slug: 'loc-store-dl000128', name: 'Lộc Store', isActive: false }, active_package: { id: 'p1', tier: 'TIER_2', quantity: 50, remainingCommissionSlots: 45, discountRate: '0.4', product: { name: 'Mindo Genesis' } }, contract: undefined },
  { id: 'a2', code: 'DL000127', businessName: 'Mai Mindo', phone: '0901234567', address: 'Đà Nẵng', status: 'APPROVED', totalRevenueVnd: '285000000', totalCommissionVnd: '28530000', child_count: 8, createdAt: '2026-09-06T03:00:00.000Z', user: { id: 'u2', fullName: 'Trần Thị Mai', email: 'mai.tran@example.com', referralCode: 'REFMAI' }, store: { id: 's2', slug: 'mai-mindo-dl000127', name: 'Mai Mindo', isActive: true }, active_package: { id: 'p2', tier: 'TIER_2', quantity: 50, remainingCommissionSlots: 38, discountRate: '0.4', product: { name: 'Mindo Genesis' } }, contract: { contractNumber: 'MD-2026-DL000127', issuedAt: '2026-09-06T03:30:00.000Z' } },
  { id: 'a3', code: 'DL000126', businessName: 'Huy NFT', phone: '0911222333', address: 'Hà Nội', status: 'APPROVED', totalRevenueVnd: '156000000', totalCommissionVnd: '15670000', child_count: 5, createdAt: '2026-09-05T03:00:00.000Z', user: { id: 'u3', fullName: 'Lê Quang Huy', email: 'huy.le@example.com', referralCode: 'REFHUY' }, store: { id: 's3', slug: 'huy-nft-dl000126', name: 'Huy NFT', isActive: true }, active_package: { id: 'p3', tier: 'TIER_1', quantity: 20, remainingCommissionSlots: 15, discountRate: '0.3', product: { name: 'Mindo Genesis' } }, contract: { contractNumber: 'MD-2026-DL000126', issuedAt: '2026-09-05T04:00:00.000Z' } },
  { id: 'a4', code: 'DL000124', businessName: 'Nam Digital', phone: '0933444555', address: 'Cần Thơ', status: 'LOCKED', totalRevenueVnd: '98000000', totalCommissionVnd: '9840000', child_count: 3, createdAt: '2026-09-04T03:00:00.000Z', user: { id: 'u4', fullName: 'Đặng Hoàng Nam', email: 'nam.dang@example.com', referralCode: 'REFNAM' }, store: { id: 's4', slug: 'nam-digital-dl000124', name: 'Nam Digital', isActive: false }, active_package: { id: 'p4', tier: 'TIER_1', quantity: 10, remainingCommissionSlots: 5, discountRate: '0.3', product: { name: 'Mindo Genesis' } }, contract: { contractNumber: 'MD-2026-DL000124', issuedAt: '2026-09-04T04:00:00.000Z' } },
];

const demoExperts: AiExpert[] = [
  { id: 'e1', name: 'Minh Tâm', slug: 'mindo-tai-chinh', specialty: 'Tài chính cá nhân', description: 'Hỗ trợ kế hoạch tài chính và quản lý dòng tiền.', systemPrompt: 'Chuyên gia tài chính Mindo.', capabilities: ['CHAT', 'DOCUMENT'], isActive: true },
  { id: 'e2', name: 'An Nhiên', slug: 'mindo-suc-khoe', specialty: 'Sức khỏe tổng quát', description: 'Cung cấp thông tin sức khỏe phổ thông.', systemPrompt: 'Chuyên gia sức khỏe Mindo.', capabilities: ['CHAT', 'DOCUMENT', 'TRANSLATION'], isActive: true },
  { id: 'e3', name: 'Lam Anh', slug: 'mindo-sang-tao', specialty: 'Nội dung và hình ảnh', description: 'Hỗ trợ nội dung, hình ảnh và tài liệu.', systemPrompt: 'Chuyên gia sáng tạo Mindo.', capabilities: ['CHAT', 'IMAGE', 'DOCUMENT', 'TRANSLATION'], isActive: false },
];

export const demoData = {
  metrics: { kyc_pending: 28, deposits_pending: 41, nft_sold: 1256, transactions_need_review: 17 },
  kyc: [demoKyc],
  deposits: [
    { id: 'd1', amountVnd: '25000000', status: 'PENDING', createdAt: '2026-09-07T03:15:00.000Z', user: { fullName: 'Trần Quang Huy', email: 'huytq@gmail.com' } },
    { id: 'd2', amountVnd: '10000000', status: 'CONFIRMED', createdAt: '2026-09-07T02:58:00.000Z', user: { fullName: 'Lê Thị Bích Ngọc', email: 'ngocltb@gmail.com' } },
    { id: 'd3', amountVnd: '50000000', status: 'PENDING', createdAt: '2026-09-07T01:47:00.000Z', user: { fullName: 'Đặng Quốc Bảo', email: 'baodq@gmail.com' } },
  ] satisfies DepositRow[],
  transactions: [
    { id: 't1', totalVnd: '12500000', status: 'FAILED', createdAt: '2026-09-07T02:33:00.000Z', user: { fullName: 'Hoàng Văn Nam', email: 'namhv@gmail.com' } },
    { id: 't2', totalVnd: '3200000', status: 'COMPLETED', createdAt: '2026-09-07T02:45:00.000Z', user: { fullName: 'Phạm Duy Khang', email: 'khangpd@gmail.com' } },
    { id: 't3', totalVnd: '8750000', status: 'FAILED', createdAt: '2026-09-07T02:12:00.000Z', user: { fullName: 'Đỗ Hồng Phúc', email: 'phucdh@gmail.com' } },
    { id: 't4', totalVnd: '6400000', status: 'PENDING', createdAt: '2026-09-07T01:55:00.000Z', user: { fullName: 'Vũ Thu Hà', email: 'vuthuha@gmail.com' } },
  ] satisfies TransactionRow[],
};

export function getToken() { return sessionStorage.getItem('mindo_admin_token'); }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}), ...init?.headers },
  });
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok) throw new Error(body.message || 'Không thể kết nối máy chủ');
  return body.data;
}

export const api = {
  async login(email: string, password: string) {
    const data = await request<{ access_token: string }>('/api/v1/admin/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    sessionStorage.setItem('mindo_admin_token', data.access_token);
  },
  dashboard: () => demoMode ? Promise.resolve(demoData.metrics) : request<DashboardMetrics>('/api/v1/admin/dashboard'),
  kyc: () => demoMode ? Promise.resolve(demoData.kyc) : request<KycRow[]>('/api/v1/admin/kyc'),
  deposits: () => demoMode ? Promise.resolve(demoData.deposits) : request<DepositRow[]>('/api/v1/admin/deposits'),
  transactions: () => demoMode ? Promise.resolve(demoData.transactions) : request<TransactionRow[]>('/api/v1/admin/transactions'),
  reviewKyc: (id: string, status: 'APPROVED' | 'REJECTED', reviewNote: string) => demoMode
    ? Promise.resolve({ id, status })
    : request(`/api/v1/admin/kyc/${id}/review`, { method: 'POST', body: JSON.stringify({ status, review_note: reviewNote, rejection_reason: status === 'REJECTED' ? reviewNote : undefined }) }),
  agencyStats: () => demoMode ? Promise.resolve({ pending: 18, active: 258, month_revenue_vnd: '2458750000', month_commission_vnd: '245875000' } satisfies AgencyStats) : request<AgencyStats>('/api/v1/admin/agencies/stats'),
  agencies: (search = '', status = '') => demoMode
    ? Promise.resolve(demoAgencies.filter((row) => (!status || row.status === status) && (!search || `${row.businessName} ${row.code} ${row.user.email}`.toLowerCase().includes(search.toLowerCase()))))
    : request<AgencyRow[]>(`/api/v1/admin/agencies?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`),
  agencyDetail: (id: string) => demoMode ? Promise.resolve(demoAgencies.find((row) => row.id === id)!) : request<AgencyRow>(`/api/v1/admin/agencies/${id}`),
  reviewAgency: (id: string, status: AgencyStatus, note: string) => demoMode
    ? Promise.resolve({ id, status })
    : request(`/api/v1/admin/agencies/${id}/review`, { method: 'POST', body: JSON.stringify({ status, review_note: note, rejection_reason: status === 'REJECTED' ? note : undefined }) }),
  async downloadAgencyContract(id: string) {
    if (demoMode) return;
    const response = await fetch(`${API_URL}/api/v1/admin/agencies/${id}/contract`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!response.ok) throw new Error('Không thể tải hợp đồng');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'hop-dong-mindo.html';
    anchor.click();
    URL.revokeObjectURL(url);
  },
  adminAccounts: () => demoMode ? Promise.resolve([
    { id: 'ad1', email: 'admin@mindo.local', full_name: 'Admin Mindo', role: 'admin', status: 'active', created_at: Date.now() },
    { id: 'ad2', email: 'compliance@mindo.local', full_name: 'Nguyễn Kiểm Soát', role: 'compliance', status: 'active', created_at: Date.now() - 86400000 },
  ] satisfies AdminAccount[]) : request<AdminAccount[]>('/api/v1/admin/accounts'),
  createAdmin: (payload: { email: string; full_name: string; password: string; role: string }) => demoMode ? Promise.resolve(payload) : request('/api/v1/admin/accounts', { method: 'POST', body: JSON.stringify({ ...payload, role: payload.role.toUpperCase() }) }),
  updateAdminRole: (id: string, role: string) => demoMode ? Promise.resolve({ id, role }) : request(`/api/v1/admin/accounts/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role: role.toUpperCase() }) }),
  resetAdminPassword: (id: string, password: string) => demoMode ? Promise.resolve({ reset: true }) : request(`/api/v1/admin/accounts/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),
  deleteAdmin: (id: string) => demoMode ? Promise.resolve({ id }) : request(`/api/v1/admin/accounts/${id}`, { method: 'DELETE' }),
  aiExperts: () => demoMode ? Promise.resolve(demoExperts) : request<AiExpert[]>('/api/v1/admin/ai-experts'),
  saveAiExpert: (expert: Partial<AiExpert> & { name: string; slug: string; specialty: string; description: string; systemPrompt: string }) => {
    const payload = { name: expert.name, slug: expert.slug, specialty: expert.specialty, description: expert.description, system_prompt: expert.systemPrompt, capabilities: expert.capabilities, is_active: expert.isActive };
    if (demoMode) return Promise.resolve({ ...expert, id: expert.id ?? `demo-${Date.now()}` });
    return request(expert.id ? `/api/v1/admin/ai-experts/${expert.id}` : '/api/v1/admin/ai-experts', { method: expert.id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
  },
  toggleAiExpert: (id: string) => demoMode ? Promise.resolve({ id }) : request(`/api/v1/admin/ai-experts/${id}/toggle`, { method: 'POST' }),
};
