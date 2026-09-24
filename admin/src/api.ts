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
  title?: string;
  totalPackagesPurchased?: number;
  discountRate?: string;
  remaining_commission_slots?: number;
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
export type AgencyPackageConfig = {
  base_price_usd: string;
  usd_vnd_rate: string;
  unit_price_vnd: string;
  tiers: Array<{ code: string; title: string; from_package: number; to_package: number | null; discount_percent: number }>;
  updated_at: string;
};
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

export type ReferralSettings = {
  direct_rate_percent: number;
  branch_rate_percent: number;
  updated_at: string;
};

export type SystemReferralCodeRow = {
  id: string;
  code: string;
  label?: string;
  isActive: boolean;
  claimedAt?: string;
  createdAt: string;
  downline_count: number;
  downline_sales_vnd: string;
  branch_commission_vnd: string;
  claimedBy?: { id: string; fullName: string; email: string; referralCode: string; createdAt: string };
  createdBy: { fullName: string; email: string };
};

export type NewsTopic = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  _count?: { articles: number; interests: number };
};

export type NewsExpert = {
  id: string;
  name: string;
  slug: string;
  specialty: string;
  bio: string;
  avatar_url?: string;
  cover_url?: string;
  initials: string;
  is_verified: boolean;
  is_active: boolean;
  sort_order: number;
  follower_count: number;
  article_count: number;
};

export type NewsArticle = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  content: string;
  image_url?: string;
  video_url?: string;
  source_url?: string;
  content_type: 'ARTICLE' | 'WAVE';
  status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
  published_at?: string;
  created_at: string;
  topic?: NewsTopic;
  expert?: NewsExpert;
  like_count: number;
  source?: { id: string; key: string; name: string; base_url: string };
  source_author?: string;
  source_content?: string;
  source_published_at?: string;
  source_fetched_at?: string;
};

export type NewsCrawlRun = {
  id: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  discovered: number;
  imported: number;
  skipped: number;
  failed: number;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
};

export type NewsSource = {
  id: string;
  key: string;
  name: string;
  baseUrl: string;
  listingUrl: string;
  isActive: boolean;
  crawlIntervalMinutes: number;
  maxItemsPerRun: number;
  topicId?: string;
  lastCrawledAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  topic?: NewsTopic;
  _count: { articles: number; crawlRuns: number };
  crawlRuns: NewsCrawlRun[];
};

export type SaveNewsArticle = {
  title: string;
  slug: string;
  summary: string;
  content: string;
  image_url?: string;
  video_url?: string;
  source_url?: string;
  content_type: 'ARTICLE' | 'WAVE';
  status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
  topic_id?: string;
  expert_id?: string;
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
  { id: 'a1', code: 'DL000128', businessName: 'Lộc Store', phone: '0988123456', address: '123 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh', taxCode: '0123456789-001', status: 'PENDING', totalRevenueVnd: '320000000', totalCommissionVnd: '32050000', title: 'TIER_2', totalPackagesPurchased: 50, discountRate: '0.3', remaining_commission_slots: 45, child_count: 12, createdAt: '2026-09-07T02:15:00.000Z', user: { id: 'u1', fullName: 'Nguyễn Văn Lộc', email: 'loc.nguyen@example.com', referralCode: 'REFLOC' }, store: { id: 's1', slug: 'loc-store-dl000128', name: 'Lộc Store', isActive: false }, active_package: { id: 'p1', tier: 'TIER_2', quantity: 50, remainingCommissionSlots: 45, discountRate: '0.3', product: { name: 'Mindo Genesis' } }, contract: undefined },
  { id: 'a2', code: 'DL000127', businessName: 'Mai Mindo', phone: '0901234567', address: 'Đà Nẵng', status: 'APPROVED', totalRevenueVnd: '285000000', totalCommissionVnd: '28530000', title: 'TIER_2', totalPackagesPurchased: 72, discountRate: '0.3', remaining_commission_slots: 38, child_count: 8, createdAt: '2026-09-06T03:00:00.000Z', user: { id: 'u2', fullName: 'Trần Thị Mai', email: 'mai.tran@example.com', referralCode: 'REFMAI' }, store: { id: 's2', slug: 'mai-mindo-dl000127', name: 'Mai Mindo', isActive: true }, active_package: { id: 'p2', tier: 'TIER_2', quantity: 50, remainingCommissionSlots: 38, discountRate: '0.3', product: { name: 'Mindo Genesis' } }, contract: { contractNumber: 'MD-2026-DL000127', issuedAt: '2026-09-06T03:30:00.000Z' } },
  { id: 'a3', code: 'DL000126', businessName: 'Huy NFT', phone: '0911222333', address: 'Hà Nội', status: 'APPROVED', totalRevenueVnd: '156000000', totalCommissionVnd: '15670000', title: 'TIER_1', totalPackagesPurchased: 20, discountRate: '0.2', remaining_commission_slots: 15, child_count: 5, createdAt: '2026-09-05T03:00:00.000Z', user: { id: 'u3', fullName: 'Lê Quang Huy', email: 'huy.le@example.com', referralCode: 'REFHUY' }, store: { id: 's3', slug: 'huy-nft-dl000126', name: 'Huy NFT', isActive: true }, active_package: { id: 'p3', tier: 'TIER_1', quantity: 20, remainingCommissionSlots: 15, discountRate: '0.2', product: { name: 'Mindo Genesis' } }, contract: { contractNumber: 'MD-2026-DL000126', issuedAt: '2026-09-05T04:00:00.000Z' } },
  { id: 'a4', code: 'DL000124', businessName: 'Nam Digital', phone: '0933444555', address: 'Cần Thơ', status: 'LOCKED', totalRevenueVnd: '98000000', totalCommissionVnd: '9840000', title: 'TIER_1', totalPackagesPurchased: 10, discountRate: '0.2', remaining_commission_slots: 5, child_count: 3, createdAt: '2026-09-04T03:00:00.000Z', user: { id: 'u4', fullName: 'Đặng Hoàng Nam', email: 'nam.dang@example.com', referralCode: 'REFNAM' }, store: { id: 's4', slug: 'nam-digital-dl000124', name: 'Nam Digital', isActive: false }, active_package: { id: 'p4', tier: 'TIER_1', quantity: 10, remainingCommissionSlots: 5, discountRate: '0.2', product: { name: 'Mindo Genesis' } }, contract: { contractNumber: 'MD-2026-DL000124', issuedAt: '2026-09-04T04:00:00.000Z' } },
];

const demoAgencyPackageConfig: AgencyPackageConfig = {
  base_price_usd: '25', usd_vnd_rate: '25000', unit_price_vnd: '625000', updated_at: new Date().toISOString(),
  tiers: [
    { code: 'TIER_1', title: 'Đại lý 1', from_package: 1, to_package: 49, discount_percent: 20 },
    { code: 'TIER_2', title: 'Đại lý 2', from_package: 50, to_package: 199, discount_percent: 30 },
    { code: 'TIER_3', title: 'Đại lý 3', from_package: 200, to_package: null, discount_percent: 40 },
  ],
};

const demoExperts: AiExpert[] = [
  { id: 'e1', name: 'Minh Tâm', slug: 'mindo-tai-chinh', specialty: 'Tài chính cá nhân', description: 'Hỗ trợ kế hoạch tài chính và quản lý dòng tiền.', systemPrompt: 'Chuyên gia tài chính Mindo.', capabilities: ['CHAT', 'DOCUMENT'], isActive: true },
  { id: 'e2', name: 'An Nhiên', slug: 'mindo-suc-khoe', specialty: 'Sức khỏe tổng quát', description: 'Cung cấp thông tin sức khỏe phổ thông.', systemPrompt: 'Chuyên gia sức khỏe Mindo.', capabilities: ['CHAT', 'DOCUMENT', 'TRANSLATION'], isActive: true },
  { id: 'e3', name: 'Lam Anh', slug: 'mindo-sang-tao', specialty: 'Nội dung và hình ảnh', description: 'Hỗ trợ nội dung, hình ảnh và tài liệu.', systemPrompt: 'Chuyên gia sáng tạo Mindo.', capabilities: ['CHAT', 'IMAGE', 'DOCUMENT', 'TRANSLATION'], isActive: false },
];

const demoNewsTopics: NewsTopic[] = [
  { id: 'nt1', name: 'Bất động sản', slug: 'bat-dong-san', isActive: true, sortOrder: 1, _count: { articles: 2, interests: 128 } },
  { id: 'nt2', name: 'Tài chính cá nhân', slug: 'tai-chinh-ca-nhan', isActive: true, sortOrder: 2, _count: { articles: 1, interests: 96 } },
  { id: 'nt3', name: 'Pháp lý', slug: 'phap-ly', isActive: true, sortOrder: 3, _count: { articles: 0, interests: 74 } },
];
const demoNewsExperts: NewsExpert[] = [
  { id: 'ne1', name: 'Bất động sản 360', slug: 'bat-dong-san-360', specialty: 'Bất động sản & Đầu tư', bio: 'Phân tích thị trường căn hộ và cơ hội đầu tư.', initials: 'BĐ', is_verified: true, is_active: true, sort_order: 1, follower_count: 21300, article_count: 148 },
  { id: 'ne2', name: 'Vốn & Dòng tiền', slug: 'von-dong-tien', specialty: 'Tài chính cá nhân', bio: 'Kiến thức quản lý dòng tiền rõ ràng, dễ áp dụng.', initials: 'VD', is_verified: true, is_active: true, sort_order: 2, follower_count: 12000, article_count: 86 },
];
const demoNewsArticles: NewsArticle[] = [
  { id: 'na1', title: '5 sai lầm thường gặp khi đầu tư căn hộ cho thuê', slug: '5-sai-lam-dau-tu-can-ho', summary: 'Những lỗi cơ bản có thể khiến dòng tiền âm ngay trong năm đầu.', content: 'Đầu tư căn hộ cho thuê không khó, nhưng người mới thường mắc những lỗi cơ bản khiến dòng tiền âm ngay năm đầu.', image_url: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=320&q=80', source_url: 'https://example.com/news/source-article', source: { id: 'source-1', key: 'investing', name: 'Investing.com', base_url: 'https://www.investing.com' }, source_author: 'Ban biên tập nguồn', source_content: 'Đây là toàn bộ phần nội dung được lấy từ bài viết nguồn để biên tập viên Mindo đọc, đối chiếu số liệu và viết lại thành bài riêng. Nội dung này chỉ hiển thị trong trang quản trị, không được trả về API công khai và không tự động xuất bản.', source_published_at: new Date().toISOString(), source_fetched_at: new Date().toISOString(), content_type: 'ARTICLE', status: 'PUBLISHED', published_at: new Date().toISOString(), created_at: new Date().toISOString(), topic: demoNewsTopics[0], expert: demoNewsExperts[0], like_count: 18 },
  { id: 'na2', title: 'Cách đọc bảng giá căn hộ trong 60 giây', slug: 'cach-doc-bang-gia-can-ho', summary: 'Hiểu nhanh các chỉ số quan trọng trước khi xuống tiền.', content: 'Video hướng dẫn đọc bảng giá căn hộ.', image_url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=320&q=80', video_url: 'https://example.test/wave.mp4', content_type: 'WAVE', status: 'DRAFT', created_at: new Date().toISOString(), topic: demoNewsTopics[0], expert: demoNewsExperts[0], like_count: 0 },
];
const demoNewsSources: NewsSource[] = ['Investing.com', 'Forex Factory', 'CME Group', 'ICE', 'Yahoo Finance', 'Federal Reserve', 'European Central Bank', 'International Monetary Fund', 'World Bank', 'OPEC'].map((name, index) => ({
  id: `source-${index + 1}`, key: name.toLowerCase().replace(/\s+/g, '-'), name,
  baseUrl: 'https://example.com', listingUrl: 'https://example.com/news', isActive: true,
  crawlIntervalMinutes: index < 2 ? 120 : 180, maxItemsPerRun: 8,
  lastCrawledAt: index < 3 ? new Date(Date.now() - index * 3600000).toISOString() : undefined,
  _count: { articles: index * 3, crawlRuns: index + 1 }, crawlRuns: [],
}));

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
  agencyPackageSettings: () => demoMode ? Promise.resolve(demoAgencyPackageConfig) : request<AgencyPackageConfig>('/api/v1/admin/agency-package-settings'),
  updateAgencyPackageSettings: (usdVndRate: number) => demoMode
    ? Promise.resolve({ ...demoAgencyPackageConfig, usd_vnd_rate: String(usdVndRate), unit_price_vnd: String(Math.round(25 * usdVndRate)), updated_at: new Date().toISOString() })
    : request<AgencyPackageConfig>('/api/v1/admin/agency-package-settings', { method: 'PATCH', body: JSON.stringify({ usd_vnd_rate: usdVndRate }) }),
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
  referralSettings: () => demoMode
    ? Promise.resolve({ direct_rate_percent: 10, branch_rate_percent: 5, updated_at: new Date().toISOString() } satisfies ReferralSettings)
    : request<ReferralSettings>('/api/v1/admin/referrals/settings'),
  updateReferralSettings: (directRate: number, branchRate: number) => demoMode
    ? Promise.resolve({ direct_rate_percent: directRate, branch_rate_percent: branchRate, updated_at: new Date().toISOString() } satisfies ReferralSettings)
    : request<ReferralSettings>('/api/v1/admin/referrals/settings', { method: 'PATCH', body: JSON.stringify({ direct_rate_percent: directRate, branch_rate_percent: branchRate }) }),
  systemReferralCodes: () => demoMode ? Promise.resolve([] as SystemReferralCodeRow[]) : request<SystemReferralCodeRow[]>('/api/v1/admin/referrals/system-codes'),
  createSystemReferralCode: (label: string) => request<SystemReferralCodeRow>('/api/v1/admin/referrals/system-codes', { method: 'POST', body: JSON.stringify({ label: label || undefined }) }),
  setSystemReferralCodeActive: (id: string, isActive: boolean) => request(`/api/v1/admin/referrals/system-codes/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }),
  newsArticles: () => demoMode ? Promise.resolve(demoNewsArticles) : request<NewsArticle[]>('/api/v1/admin/news/articles?limit=50'),
  saveNewsArticle: (article: SaveNewsArticle & { id?: string }) => {
    if (demoMode) return Promise.resolve({ ...demoNewsArticles[0], ...article, id: article.id ?? `demo-${Date.now()}` });
    const payload = {
      title: article.title, slug: article.slug, summary: article.summary, content: article.content,
      image_url: article.image_url || undefined, video_url: article.video_url || undefined, source_url: article.source_url || undefined,
      content_type: article.content_type, status: article.status, topic_id: article.topic_id || undefined, expert_id: article.expert_id || undefined,
    };
    return request<NewsArticle>(article.id ? `/api/v1/admin/news/articles/${article.id}` : '/api/v1/admin/news/articles', { method: article.id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
  },
  newsTopics: () => demoMode ? Promise.resolve(demoNewsTopics) : request<NewsTopic[]>('/api/v1/admin/news/topics'),
  saveNewsTopic: (topic: { id?: string; name: string; slug: string; is_active: boolean; sort_order: number }) => demoMode ? Promise.resolve({ id: topic.id ?? `demo-${Date.now()}`, name: topic.name, slug: topic.slug, isActive: topic.is_active, sortOrder: topic.sort_order }) : request<NewsTopic>(topic.id ? `/api/v1/admin/news/topics/${topic.id}` : '/api/v1/admin/news/topics', { method: topic.id ? 'PATCH' : 'POST', body: JSON.stringify(topic) }),
  newsExperts: () => demoMode ? Promise.resolve(demoNewsExperts) : request<NewsExpert[]>('/api/v1/admin/news/experts'),
  saveNewsExpert: (expert: { id?: string; name: string; slug: string; specialty: string; bio: string; avatar_url?: string; cover_url?: string; initials?: string; is_verified: boolean; is_active: boolean; sort_order: number }) => demoMode ? Promise.resolve({ ...demoNewsExperts[0], ...expert, id: expert.id ?? `demo-${Date.now()}` }) : request<NewsExpert>(expert.id ? `/api/v1/admin/news/experts/${expert.id}` : '/api/v1/admin/news/experts', { method: expert.id ? 'PATCH' : 'POST', body: JSON.stringify(expert) }),
  newsSources: () => demoMode ? Promise.resolve(demoNewsSources) : request<NewsSource[]>('/api/v1/admin/news/sources'),
  saveNewsSource: (source: Pick<NewsSource, 'id' | 'isActive' | 'crawlIntervalMinutes' | 'maxItemsPerRun'> & { topicId?: string }) => demoMode ? Promise.resolve(source) : request<NewsSource>(`/api/v1/admin/news/sources/${source.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: source.isActive, crawl_interval_minutes: source.crawlIntervalMinutes, max_items_per_run: source.maxItemsPerRun, topic_id: source.topicId ?? '' }) }),
  crawlNewsSource: (id: string) => demoMode ? Promise.resolve({ job_id: `demo-${Date.now()}`, source_id: id }) : request<{ job_id: string; source_id: string }>(`/api/v1/admin/news/sources/${id}/crawl`, { method: 'POST' }),
  crawlAllNewsSources: () => demoMode ? Promise.resolve({ queued: demoNewsSources.length }) : request<{ queued: number }>('/api/v1/admin/news/sources/crawl-all', { method: 'POST' }),
};
