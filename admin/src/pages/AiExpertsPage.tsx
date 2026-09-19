import { Bot, Pencil, Plus, Power } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type AiExpert } from '../api';

const emptyExpert = { name: '', slug: '', specialty: '', description: '', systemPrompt: '', capabilities: ['CHAT'], isActive: true };

export function AiExpertsPage() {
  const [rows, setRows] = useState<AiExpert[]>([]);
  const [editing, setEditing] = useState<(typeof emptyExpert & { id?: string })>();
  const [error, setError] = useState('');
  async function load() { try { setRows(await api.aiExperts()); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải chuyên gia AI'); } }
  useEffect(() => { void load(); }, []);
  async function save(event: React.FormEvent) { event.preventDefault(); if (!editing) return; try { await api.saveAiExpert(editing); setEditing(undefined); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu chuyên gia'); } }
  async function toggle(id: string) { try { await api.toggleAiExpert(id); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể đổi trạng thái'); } }
  return <div className="page"><div className="page-heading"><span><h1>AI chuyên gia</h1><p>Cấu hình chuyên môn và khả năng được phép cho từng trợ lý.</p></span><button className="primary-button" onClick={() => setEditing({ ...emptyExpert })}><Plus size={17} /> Tạo chuyên gia</button></div>
    {error ? <div className="error-banner">{error}</div> : null}
    {editing ? <ExpertForm value={editing} onChange={setEditing} onSubmit={save} onCancel={() => setEditing(undefined)} /> : null}
    <section className="work-panel"><div className="table-heading"><h2>Danh sách chuyên gia</h2></div><div className="expert-list">{rows.map((expert) => <article className="expert-row" key={expert.id}><span className="expert-avatar"><Bot /></span><span className="expert-copy"><strong>{expert.name}</strong><small>{expert.specialty}</small><p>{expert.description}</p><span className="capabilities">{expert.capabilities.map((item) => <em key={item}>{item}</em>)}</span></span><span className={`status ${expert.isActive ? 'success' : 'danger'}`}>{expert.isActive ? 'Đang hoạt động' : 'Đã tắt'}</span><span className="row-actions"><button className="icon-button" onClick={() => setEditing({ ...expert })}><Pencil size={17} /></button><button className="icon-button" onClick={() => void toggle(expert.id)}><Power size={17} /></button></span></article>)}</div></section>
  </div>;
}

function ExpertForm({ value, onChange, onSubmit, onCancel }: { value: typeof emptyExpert & { id?: string }; onChange: (value: typeof emptyExpert & { id?: string }) => void; onSubmit: (event: React.FormEvent) => void; onCancel: () => void }) {
  const capabilityOptions = ['CHAT', 'IMAGE', 'DOCUMENT', 'TRANSLATION'];
  function toggleCapability(item: string) { onChange({ ...value, capabilities: value.capabilities.includes(item) ? value.capabilities.filter((entry) => entry !== item) : [...value.capabilities, item] }); }
  return <form className="expert-form" onSubmit={onSubmit}><div className="form-grid"><label>Tên chuyên gia<input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} required /></label><label>Đường dẫn<input value={value.slug} onChange={(event) => onChange({ ...value, slug: event.target.value })} required /></label><label>Chuyên môn<input value={value.specialty} onChange={(event) => onChange({ ...value, specialty: event.target.value })} required /></label><label className="wide-field">Mô tả<textarea value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} required /></label><label className="wide-field">Chỉ dẫn hệ thống<textarea value={value.systemPrompt} onChange={(event) => onChange({ ...value, systemPrompt: event.target.value })} required /></label></div><fieldset><legend>Khả năng</legend>{capabilityOptions.map((item) => <label key={item}><input type="checkbox" checked={value.capabilities.includes(item)} onChange={() => toggleCapability(item)} /> {item}</label>)}</fieldset><div className="form-actions"><button type="button" className="outline-button" onClick={onCancel}>Hủy</button><button className="primary-button">Lưu chuyên gia</button></div></form>;
}
