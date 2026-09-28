import { Boxes, Check, CircleDollarSign, Image, PackagePlus, Pencil, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type AgencyPackageConfig, type NftProduct, type SaveNftProduct } from '../api';

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const emptyForm = { name: '', symbol: 'PEER', description: '', image_url: '', metadata_base_url: 'https://api-mindo.stg-studio.com/metadata', total_supply: '1000' };

export function ProductsPage() {
  const [rows, setRows] = useState<NftProduct[]>([]);
  const [config, setConfig] = useState<AgencyPackageConfig>();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<NftProduct>();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setError('');
    try {
      const [products, pricing] = await Promise.all([api.nftProducts(), api.agencyPackageSettings()]);
      setRows(products); setConfig(pricing);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải sản phẩm Peer'); }
  }
  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => rows.filter((row) => `${row.name} ${row.symbol} ${row.description}`.toLowerCase().includes(query.trim().toLowerCase())), [rows, query]);
  const totalSupply = rows.reduce((sum, row) => sum + row.totalSupply, 0);
  const totalSold = rows.reduce((sum, row) => sum + row.soldCount, 0);

  function openCreate() { setEditing(undefined); setForm(emptyForm); setShowForm(true); setError(''); setMessage(''); }
  function openEdit(row: NftProduct) {
    setEditing(row);
    setForm({ name: row.name, symbol: row.symbol, description: row.description, image_url: row.imageUrl, metadata_base_url: row.metadataBaseUrl, total_supply: String(row.totalSupply) });
    setShowForm(true); setError(''); setMessage('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const totalSupplyValue = Number(form.total_supply);
    if (!Number.isInteger(totalSupplyValue) || totalSupplyValue < 1) { setError('Tổng nguồn cung phải là số nguyên lớn hơn 0.'); return; }
    if (editing && totalSupplyValue < editing.soldCount) { setError(`Nguồn cung không thể thấp hơn ${editing.soldCount} Peer đã bán.`); return; }
    const payload: SaveNftProduct = {
      name: form.name.trim(), symbol: form.symbol.trim().toUpperCase(), description: form.description.trim(),
      image_url: form.image_url.trim(), metadata_base_url: form.metadata_base_url.trim(),
      unit_price_vnd: config?.unit_price_vnd ?? String(25 * Number(config?.usd_vnd_rate ?? 25000)), total_supply: totalSupplyValue,
    };
    setBusy(true); setError(''); setMessage('');
    try {
      if (editing) await api.updateNftProduct(editing.id, payload);
      else await api.createNftProduct(payload);
      setMessage(editing ? 'Đã cập nhật sản phẩm Peer.' : 'Đã tạo sản phẩm Peer mới.');
      setShowForm(false); setEditing(undefined); setForm(emptyForm); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu sản phẩm'); }
    finally { setBusy(false); }
  }

  async function toggle(row: NftProduct) {
    setBusy(true); setError(''); setMessage('');
    try { await api.updateNftProduct(row.id, { is_active: !row.isActive }); setMessage(row.isActive ? 'Đã tạm ẩn sản phẩm khỏi web.' : 'Đã mở bán lại sản phẩm.'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể cập nhật trạng thái'); }
    finally { setBusy(false); }
  }

  return <div className="page operations-page">
    <div className="page-title-row"><div><h1>Sản phẩm Peer</h1><p>Quản lý sản phẩm nội bộ, nguồn cung và trạng thái hiển thị trên website.</p></div><span className="heading-actions"><button className="outline-button" onClick={() => void load()}><RefreshCw size={17} /> Làm mới</button><button className="primary-button" onClick={openCreate}><PackagePlus size={17} /> Tạo sản phẩm</button></span></div>
    {error ? <div className="error-banner">{error}</div> : null}
    {message ? <div className="success-banner"><Check size={16} /> {message}</div> : null}
    <section className="metric-row">
      <Metric label="Sản phẩm" value={rows.length.toLocaleString('vi-VN')} icon={Boxes} />
      <Metric label="Đang mở bán" value={rows.filter((row) => row.isActive).length.toLocaleString('vi-VN')} icon={Check} />
      <Metric label="Đã cấp" value={totalSold.toLocaleString('vi-VN')} icon={PackagePlus} />
      <Metric label="Nguồn cung còn lại" value={Math.max(0, totalSupply - totalSold).toLocaleString('vi-VN')} icon={CircleDollarSign} />
    </section>
    <section className="pricing-summary"><div><small>Giá niêm yết</small><strong>25 USD / Peer</strong></div><div><small>Tỷ giá đang áp dụng</small><strong>{Number(config?.usd_vnd_rate ?? 0).toLocaleString('vi-VN')} VND/USD</strong></div><div><small>Giá quy đổi trước chiết khấu</small><strong>{money.format(Number(config?.unit_price_vnd ?? 0))}</strong></div><p>Giá thanh toán thực tế được tính theo danh hiệu của người mua tại thời điểm khóa báo giá.</p></section>
    {showForm ? <form className="product-editor" onSubmit={(event) => void submit(event)}>
      <header><div><h2>{editing ? 'Chỉnh sửa sản phẩm' : 'Tạo sản phẩm Peer'}</h2><p>Sản phẩm được cấp nội bộ, không phát hành lên blockchain.</p></div><button type="button" className="icon-button" onClick={() => setShowForm(false)} aria-label="Đóng"><X size={18} /></button></header>
      <div className="product-form-grid"><label><span>Tên sản phẩm</span><input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Mindo Genesis" /></label><label><span>Mã sản phẩm</span><input required minLength={2} value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value.toUpperCase() })} placeholder="PEER" /></label><label><span>Tổng nguồn cung</span><input required type="number" min={editing?.soldCount || 1} step="1" value={form.total_supply} onChange={(event) => setForm({ ...form, total_supply: event.target.value })} /></label><label className="wide-field"><span>Mô tả</span><textarea required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Mô tả quyền lợi và thông tin sản phẩm..." /></label><label className="wide-field"><span>URL hình ảnh</span><input required type="url" value={form.image_url} onChange={(event) => setForm({ ...form, image_url: event.target.value })} placeholder="https://..." /></label><label className="wide-field"><span>Metadata base URL</span><input required type="url" value={form.metadata_base_url} onChange={(event) => setForm({ ...form, metadata_base_url: event.target.value })} placeholder="https://.../metadata" /></label></div>
      <footer><button type="button" className="outline-button" onClick={() => setShowForm(false)}>Hủy</button><button className="primary-button" disabled={busy}>{busy ? 'Đang lưu...' : editing ? 'Lưu thay đổi' : 'Tạo sản phẩm'}</button></footer>
    </form> : null}
    <section className="work-panel"><div className="filters single-filter"><label className="search"><Search size={18} /><input aria-label="Tìm sản phẩm" placeholder="Tìm tên, mã hoặc mô tả sản phẩm" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div><div className="table-heading"><h2>Danh mục sản phẩm</h2></div><div className="table-scroll"><table><thead><tr><th>Sản phẩm</th><th>Trạng thái</th><th>Đã cấp</th><th>Còn lại</th><th>Tỷ lệ bán</th><th>Cập nhật</th><th>Thao tác</th></tr></thead><tbody>
      {visible.map((row) => { const available = Math.max(0, row.totalSupply - row.soldCount); const percent = row.totalSupply ? Math.min(100, row.soldCount / row.totalSupply * 100) : 0; return <tr key={row.id}><td><span className="product-cell">{row.imageUrl ? <img src={row.imageUrl} alt="" /> : <span><Image size={18} /></span>}<span><strong>{row.name}</strong><small>{row.symbol} · MINDO_INTERNAL</small></span></span></td><td><span className={`status ${row.isActive ? 'success' : 'danger'}`}>{row.isActive ? 'Đang mở bán' : 'Đã ẩn'}</span></td><td>{row.soldCount.toLocaleString('vi-VN')} / {row.totalSupply.toLocaleString('vi-VN')}</td><td>{available.toLocaleString('vi-VN')}</td><td><span className="supply-progress"><i style={{ width: `${percent}%` }} /></span><small>{percent.toFixed(1)}%</small></td><td>{new Date(row.updatedAt).toLocaleDateString('vi-VN')}</td><td><span className="row-actions"><button className="text-button" onClick={() => openEdit(row)}><Pencil size={14} /> Sửa</button><button className="text-button" disabled={busy} onClick={() => void toggle(row)}>{row.isActive ? 'Tạm ẩn' : 'Mở bán'}</button></span></td></tr>; })}
      {visible.length === 0 ? <tr><td colSpan={7} className="empty">Chưa có sản phẩm phù hợp.</td></tr> : null}
    </tbody></table></div><footer className="table-footer"><span>Hiển thị <strong>{visible.length}</strong> sản phẩm</span></footer></section>
  </div>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Boxes }) { return <div className="metric"><span className="metric-icon"><Icon /></span><span><small>{label}</small><strong>{value}</strong></span></div>; }
