import { KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type AdminAccount } from '../api';

const roleLabels: Record<string, string> = { admin: 'Quản trị toàn hệ thống', compliance: 'Kiểm duyệt & KYC', finance: 'Tài chính' };

export function AdminAccountsPage() {
  const [rows, setRows] = useState<AdminAccount[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'compliance' });
  async function load() { try { setRows(await api.adminAccounts()); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải tài khoản'); } }
  useEffect(() => { void load(); }, []);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    try { await api.createAdmin(form); setForm({ email: '', full_name: '', password: '', role: 'compliance' }); setShowForm(false); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tạo tài khoản'); }
  }
  async function updateRole(id: string, role: string) { try { await api.updateAdminRole(id, role); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể cập nhật quyền'); } }
  async function resetPassword(id: string) { const password = window.prompt('Nhập mật khẩu mới (ít nhất 8 ký tự)'); if (!password) return; try { await api.resetAdminPassword(id, password); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể đặt lại mật khẩu'); } }
  async function remove(id: string) { if (!window.confirm('Xóa quyền truy cập của tài khoản này?')) return; try { await api.deleteAdmin(id); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể xóa tài khoản'); } }
  return <div className="page"><div className="page-heading"><span><h1>Phân quyền Admin</h1><p>Tạo tài khoản và giới hạn quyền theo vai trò vận hành.</p></span><button className="primary-button" onClick={() => setShowForm((value) => !value)}><Plus size={17} /> Tạo tài khoản</button></div>
    {error ? <div className="error-banner">{error}</div> : null}
    {showForm ? <form className="inline-form admin-form" onSubmit={(event) => void create(event)}><label>Họ tên<input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} required /></label><label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label><label>Mật khẩu tạm<input type="password" minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label><label>Vai trò<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="admin">Admin</option><option value="compliance">Compliance</option><option value="finance">Finance</option></select></label><button className="primary-button">Lưu tài khoản</button></form> : null}
    <section className="work-panel"><div className="table-heading"><h2>Danh sách tài khoản quản trị</h2></div><div className="table-scroll"><table><thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Quyền chính</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className="entity-cell"><span className="row-icon"><ShieldCheck size={16} /></span><span><strong>{row.full_name}</strong><small>{row.email}</small></span></span></td><td><select className="table-select" value={row.role} onChange={(event) => void updateRole(row.id, event.target.value)}><option value="admin">Admin</option><option value="compliance">Compliance</option><option value="finance">Finance</option></select></td><td>{roleLabels[row.role]}</td><td><span className="status success">{row.status === 'active' ? 'Đang hoạt động' : row.status}</span></td><td><span className="row-actions"><button className="icon-button" title="Đặt lại mật khẩu" onClick={() => void resetPassword(row.id)}><KeyRound size={17} /></button><button className="icon-button danger-icon" title="Xóa tài khoản" onClick={() => void remove(row.id)}><Trash2 size={17} /></button></span></td></tr>)}</tbody></table></div></section>
  </div>;
}
