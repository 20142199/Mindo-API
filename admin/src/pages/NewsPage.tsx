import { BookOpen, CheckCircle2, CircleUserRound, Clock3, ExternalLink, Eye, Heart, Newspaper, Pencil, PlaySquare, Plus, RefreshCw, Rss, Settings2, Sparkles, Tags, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type NewsArticle, type NewsExpert, type NewsSource, type NewsTopic, type SaveNewsArticle } from '../api';

type Tab = 'articles' | 'experts' | 'topics' | 'sources';
type ArticleEditorValue = SaveNewsArticle & { id?: string; ai_summary?: string; source?: NewsArticle['source']; source_author?: string; source_content?: string; source_published_at?: string; source_fetched_at?: string };
const emptyArticle: SaveNewsArticle = { title: '', slug: '', summary: '', content: '', image_url: '', video_url: '', source_url: '', content_type: 'ARTICLE', status: 'DRAFT', topic_id: '', expert_id: '' };
const emptyExpert = { name: '', slug: '', specialty: '', bio: '', avatar_url: '', cover_url: '', initials: '', is_verified: true, is_active: true, sort_order: 0 };
const emptyTopic = { name: '', slug: '', is_active: true, sort_order: 0 };

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function NewsPage() {
  const [tab, setTab] = useState<Tab>('articles');
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [experts, setExperts] = useState<NewsExpert[]>([]);
  const [topics, setTopics] = useState<NewsTopic[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [articleForm, setArticleForm] = useState<ArticleEditorValue>();
  const [expertForm, setExpertForm] = useState<(typeof emptyExpert & { id?: string })>();
  const [topicForm, setTopicForm] = useState<(typeof emptyTopic & { id?: string })>();
  const [sourceForm, setSourceForm] = useState<NewsSource>();
  const [crawlingSource, setCrawlingSource] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    try {
      const [articleRows, expertRows, topicRows, sourceRows] = await Promise.all([api.newsArticles(), api.newsExperts(), api.newsTopics(), api.newsSources()]);
      setArticles(articleRows); setExperts(expertRows); setTopics(topicRows); setSources(sourceRows); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu tin tức'); }
  }
  useEffect(() => { void load(); }, []);

  const counts = useMemo(() => ({ published: articles.filter((row) => row.status === 'PUBLISHED').length, waves: articles.filter((row) => row.content_type === 'WAVE').length }), [articles]);

  async function saveArticle(event: React.FormEvent) {
    event.preventDefault(); if (!articleForm) return;
    try { await api.saveNewsArticle(articleForm); setArticleForm(undefined); setMessage('Đã lưu nội dung tin tức.'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu nội dung'); }
  }
  async function saveExpert(event: React.FormEvent) {
    event.preventDefault(); if (!expertForm) return;
    try { await api.saveNewsExpert(expertForm); setExpertForm(undefined); setMessage('Đã lưu chuyên gia.'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu chuyên gia'); }
  }
  async function saveTopic(event: React.FormEvent) {
    event.preventDefault(); if (!topicForm) return;
    try { await api.saveNewsTopic(topicForm); setTopicForm(undefined); setMessage('Đã lưu lĩnh vực.'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu lĩnh vực'); }
  }
  async function saveSource(event: React.FormEvent) {
    event.preventDefault(); if (!sourceForm) return;
    try { await api.saveNewsSource(sourceForm); setSourceForm(undefined); setMessage('Đã cập nhật lịch crawl nguồn tin.'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu nguồn tin'); }
  }
  async function crawlSource(id: string) {
    try { setCrawlingSource(id); await api.crawlNewsSource(id); setMessage('Đã xếp lịch crawl. Kết quả sẽ cập nhật trong ít phút.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể chạy crawl'); }
    finally { setCrawlingSource(''); }
  }
  async function crawlAll() {
    try { setCrawlingSource('all'); const result = await api.crawlAllNewsSources(); setMessage(`Đã xếp lịch crawl ${result.queued} nguồn tin.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể chạy crawl'); }
    finally { setCrawlingSource(''); }
  }

  return <div className="page news-page">
    <div className="page-heading"><span><h1>Trung tâm tin tức</h1><p>Quản lý nội dung hiển thị tại Tường, Khám phá và Sóng trên ứng dụng Mindo.</p></span>{tab === 'sources' ? <button className="primary-button" disabled={Boolean(crawlingSource)} onClick={() => void crawlAll()}><RefreshCw size={17} className={crawlingSource === 'all' ? 'spin' : ''} /> Crawl tất cả</button> : <button className="primary-button" onClick={() => tab === 'articles' ? setArticleForm({ ...emptyArticle }) : tab === 'experts' ? setExpertForm({ ...emptyExpert }) : setTopicForm({ ...emptyTopic })}><Plus size={17} /> {tab === 'articles' ? 'Tạo nội dung' : tab === 'experts' ? 'Thêm chuyên gia' : 'Thêm lĩnh vực'}</button>}</div>
    {error ? <div className="error-banner">{error}</div> : null}
    {message ? <div className="success-banner"><CheckCircle2 size={16} /> {message}</div> : null}
    <section className="metric-row news-metrics">
      <article className="metric"><span className="metric-icon"><Newspaper /></span><span><small>Tổng nội dung</small><strong>{articles.length}</strong></span></article>
      <article className="metric"><span className="metric-icon"><Eye /></span><span><small>Đã xuất bản</small><strong>{counts.published}</strong></span></article>
      <article className="metric"><span className="metric-icon"><CircleUserRound /></span><span><small>Chuyên gia</small><strong>{experts.length}</strong></span></article>
      <article className="metric"><span className="metric-icon"><PlaySquare /></span><span><small>Nội dung Sóng</small><strong>{counts.waves}</strong></span></article>
      <article className="metric"><span className="metric-icon"><Rss /></span><span><small>Nguồn crawl</small><strong>{sources.filter((row) => row.isActive).length}/{sources.length}</strong></span></article>
    </section>
    <div className="news-tabs" role="tablist">
      <button className={tab === 'articles' ? 'active' : ''} onClick={() => setTab('articles')}><BookOpen size={16} /> Bài viết & Sóng</button>
      <button className={tab === 'experts' ? 'active' : ''} onClick={() => setTab('experts')}><CircleUserRound size={16} /> Chuyên gia</button>
      <button className={tab === 'topics' ? 'active' : ''} onClick={() => setTab('topics')}><Tags size={16} /> Lĩnh vực</button>
      <button className={tab === 'sources' ? 'active' : ''} onClick={() => setTab('sources')}><Rss size={16} /> Nguồn crawl</button>
    </div>
    {articleForm ? <ArticleForm value={articleForm} topics={topics} experts={experts} onChange={setArticleForm} onSubmit={saveArticle} onClose={() => setArticleForm(undefined)} /> : null}
    {expertForm ? <ExpertForm value={expertForm} onChange={setExpertForm} onSubmit={saveExpert} onClose={() => setExpertForm(undefined)} /> : null}
    {topicForm ? <TopicForm value={topicForm} onChange={setTopicForm} onSubmit={saveTopic} onClose={() => setTopicForm(undefined)} /> : null}
    {sourceForm ? <SourceForm value={sourceForm} topics={topics} onChange={setSourceForm} onSubmit={saveSource} onClose={() => setSourceForm(undefined)} /> : null}
    {tab === 'articles' ? <ArticleTable rows={articles} onEdit={(row) => setArticleForm({ id: row.id, title: row.title, slug: row.slug, summary: row.summary, ai_summary: row.ai_summary, content: row.content, image_url: row.image_url ?? '', video_url: row.video_url ?? '', source_url: row.source_url ?? '', content_type: row.content_type, status: row.status, topic_id: row.topic?.id ?? '', expert_id: row.expert?.id ?? '', source: row.source, source_author: row.source_author, source_content: row.source_content, source_published_at: row.source_published_at, source_fetched_at: row.source_fetched_at })} /> : null}
    {tab === 'experts' ? <ExpertList rows={experts} onEdit={(row) => setExpertForm({ id: row.id, name: row.name, slug: row.slug, specialty: row.specialty, bio: row.bio, avatar_url: row.avatar_url ?? '', cover_url: row.cover_url ?? '', initials: row.initials, is_verified: row.is_verified, is_active: row.is_active, sort_order: row.sort_order })} /> : null}
    {tab === 'topics' ? <TopicList rows={topics} onEdit={(row) => setTopicForm({ id: row.id, name: row.name, slug: row.slug, is_active: row.isActive, sort_order: row.sortOrder })} /> : null}
    {tab === 'sources' ? <SourceList rows={sources} crawlingSource={crawlingSource} onEdit={setSourceForm} onCrawl={(id) => void crawlSource(id)} /> : null}
  </div>;
}

function ArticleTable({ rows, onEdit }: { rows: NewsArticle[]; onEdit: (row: NewsArticle) => void }) {
  return <section className="work-panel"><div className="table-heading"><h2>Danh sách nội dung</h2><p>Bài viết đã xuất bản sẽ hiển thị trên ứng dụng ngay lập tức.</p></div><div className="table-scroll"><table><thead><tr><th>Nội dung</th><th>Loại</th><th>Lĩnh vực</th><th>Chuyên gia</th><th>Tương tác</th><th>Trạng thái</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className="news-title-cell">{row.image_url ? <img src={row.image_url} alt="" /> : <span><Newspaper size={18} /></span>}<span><strong>{row.title}</strong><small>{row.summary}</small></span></span></td><td>{row.content_type === 'WAVE' ? 'Sóng' : 'Bài viết'}</td><td>{row.topic?.name ?? '—'}</td><td>{row.expert?.name ?? '—'}</td><td><span className="news-like"><Heart size={13} /> {row.like_count}</span></td><td><span className={`status ${row.status === 'PUBLISHED' ? 'success' : row.status === 'HIDDEN' ? 'danger' : 'warning'}`}>{row.status === 'PUBLISHED' ? 'Đã xuất bản' : row.status === 'HIDDEN' ? 'Đã ẩn' : 'Bản nháp'}</span></td><td><button className="icon-button" onClick={() => onEdit(row)}><Pencil size={16} /></button></td></tr>)}</tbody></table></div><div className="table-footer"><span>{rows.length} nội dung</span></div></section>;
}

function ArticleForm({ value, topics, experts, onChange, onSubmit, onClose }: { value: ArticleEditorValue; topics: NewsTopic[]; experts: NewsExpert[]; onChange: (value: ArticleEditorValue) => void; onSubmit: (event: React.FormEvent) => void; onClose: () => void }) {
  function title(valueTitle: string) { onChange({ ...value, title: valueTitle, slug: value.slug || slugify(valueTitle) }); }
  return <form className="news-editor" onSubmit={onSubmit}><header><span><h2>{value.id ? 'Chỉnh sửa nội dung' : 'Tạo nội dung mới'}</h2><p>Thông tin này được dùng trực tiếp trên màn tin tức của ứng dụng.</p></span><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></header>{value.source_content ? <section className="source-material"><header><span><strong>Nội dung nguồn để tham khảo</strong><small>{value.source?.name}{value.source_author ? ` · ${value.source_author}` : ''}{value.source_published_at ? ` · ${new Date(value.source_published_at).toLocaleString('vi-VN')}` : ''}</small></span>{value.source_url ? <a href={value.source_url} target="_blank" rel="noreferrer">Mở bài gốc <ExternalLink size={14} /></a> : null}</header><div>{value.source_content}</div></section> : null}{value.ai_summary ? <section className="ai-news-summary"><header><Sparkles size={17} /><span><strong>Tổng hợp AI</strong><small>Tự động tạo bằng tiếng Việt từ nội dung nguồn</small></span></header><div>{value.ai_summary}</div></section> : null}<div className="news-editor-grid"><label className="wide-field">Tiêu đề<input value={value.title} onChange={(event) => title(event.target.value)} required /></label><label>Đường dẫn<input value={value.slug} onChange={(event) => onChange({ ...value, slug: slugify(event.target.value) })} required /></label><label>Loại nội dung<select value={value.content_type} onChange={(event) => onChange({ ...value, content_type: event.target.value as SaveNewsArticle['content_type'] })}><option value="ARTICLE">Bài viết</option><option value="WAVE">Sóng (video)</option></select></label><label>Lĩnh vực<select value={value.topic_id} onChange={(event) => onChange({ ...value, topic_id: event.target.value })}><option value="">Chưa chọn</option>{topics.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label>Chuyên gia<select value={value.expert_id} onChange={(event) => onChange({ ...value, expert_id: event.target.value })}><option value="">Chưa chọn</option>{experts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label className="wide-field">Mô tả ngắn<textarea value={value.summary} onChange={(event) => onChange({ ...value, summary: event.target.value })} required /></label><label className="wide-field">Nội dung xuất bản<textarea className="news-content-input" value={value.content} onChange={(event) => onChange({ ...value, content: event.target.value })} required minLength={20} placeholder="Biên tập nội dung mới dựa trên phần tham khảo phía trên" /></label><label>Ảnh đại diện<input type="url" value={value.image_url} onChange={(event) => onChange({ ...value, image_url: event.target.value })} placeholder="https://..." /></label><label>Video Sóng<input type="url" value={value.video_url} onChange={(event) => onChange({ ...value, video_url: event.target.value })} placeholder="https://..." /></label><label>Nguồn bài viết<input type="url" value={value.source_url} onChange={(event) => onChange({ ...value, source_url: event.target.value })} placeholder="https://..." /></label><label>Trạng thái<select value={value.status} onChange={(event) => onChange({ ...value, status: event.target.value as SaveNewsArticle['status'] })}><option value="DRAFT">Bản nháp</option><option value="PUBLISHED">Xuất bản</option><option value="HIDDEN">Ẩn</option></select></label></div><div className="form-actions"><button type="button" className="outline-button" onClick={onClose}>Hủy</button><button className="primary-button">Lưu nội dung</button></div></form>;
}

function SourceList({ rows, crawlingSource, onEdit, onCrawl }: { rows: NewsSource[]; crawlingSource: string; onEdit: (row: NewsSource) => void; onCrawl: (id: string) => void }) {
  return <section className="work-panel"><div className="table-heading"><h2>Nguồn tin HTML</h2><p>Nội dung crawl chỉ dùng nội bộ để biên tập. Hệ thống không tự xuất bản bài gốc.</p></div><div className="source-grid">{rows.map((row) => { const run = row.crawlRuns[0]; return <article className="source-card" key={row.id}><header><span className="source-logo"><Rss size={18} /></span><span><strong>{row.name}</strong><a href={row.listingUrl} target="_blank" rel="noreferrer">{new URL(row.baseUrl).hostname} <ExternalLink size={11} /></a></span><span className={`status ${row.isActive ? 'success' : 'danger'}`}>{row.isActive ? 'Đang chạy' : 'Đã tắt'}</span></header><div className="source-stat-row"><span><small>Bài đã lấy</small><strong>{row._count.articles}</strong></span><span><small>Chu kỳ</small><strong>{row.crawlIntervalMinutes} phút</strong></span><span><small>Mỗi lượt</small><strong>{row.maxItemsPerRun} bài</strong></span></div><div className="source-run"><Clock3 size={14} /><span>{row.lastCrawledAt ? `Lần gần nhất: ${new Date(row.lastCrawledAt).toLocaleString('vi-VN')}` : 'Chưa chạy lần nào'}{run ? <small>{run.status === 'SUCCESS' ? `Thêm ${run.imported}, trùng ${run.skipped}, lỗi ${run.failed}` : run.status === 'RUNNING' ? 'Đang xử lý...' : run.errorMessage || 'Crawl thất bại'}</small> : null}</span></div>{row.lastError ? <p className="source-error">{row.lastError}</p> : null}<footer><button className="outline-button" onClick={() => onEdit(row)}><Settings2 size={15} /> Cấu hình</button><button className="primary-button" disabled={Boolean(crawlingSource)} onClick={() => onCrawl(row.id)}><RefreshCw size={15} className={crawlingSource === row.id ? 'spin' : ''} /> Crawl ngay</button></footer></article>; })}</div></section>;
}

function SourceForm({ value, topics, onChange, onSubmit, onClose }: { value: NewsSource; topics: NewsTopic[]; onChange: (value: NewsSource) => void; onSubmit: (event: React.FormEvent) => void; onClose: () => void }) {
  return <form className="news-editor compact" onSubmit={onSubmit}><header><span><h2>Cấu hình {value.name}</h2><p>Đường dẫn nguồn được cố định để crawler chỉ truy cập đúng website đã duyệt.</p></span><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></header><div className="news-editor-grid"><label>Chu kỳ crawl (phút)<input type="number" min="15" max="1440" value={value.crawlIntervalMinutes} onChange={(event) => onChange({ ...value, crawlIntervalMinutes: Number(event.target.value) })} /></label><label>Số bài mỗi lượt<input type="number" min="1" max="30" value={value.maxItemsPerRun} onChange={(event) => onChange({ ...value, maxItemsPerRun: Number(event.target.value) })} /></label><label>Lĩnh vực mặc định<select value={value.topicId ?? ''} onChange={(event) => onChange({ ...value, topicId: event.target.value || undefined })}><option value="">Chưa phân loại</option>{topics.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label className="news-check"><input type="checkbox" checked={value.isActive} onChange={(event) => onChange({ ...value, isActive: event.target.checked })} /> Tự động crawl nguồn này</label></div><div className="form-actions"><button type="button" className="outline-button" onClick={onClose}>Hủy</button><button className="primary-button">Lưu cấu hình</button></div></form>;
}

function ExpertList({ rows, onEdit }: { rows: NewsExpert[]; onEdit: (row: NewsExpert) => void }) {
  return <section className="work-panel"><div className="table-heading"><h2>Chuyên gia tin tức</h2><p>Hồ sơ xuất hiện trong phần đề xuất và Khám phá.</p></div><div className="expert-list">{rows.map((row) => <article className="expert-row" key={row.id}><span className="news-expert-avatar">{row.avatar_url ? <img src={row.avatar_url} alt="" /> : row.initials}</span><span className="expert-copy"><strong>{row.name} {row.is_verified ? <CheckCircle2 size={14} /> : null}</strong><small>{row.specialty}</small><p>{row.bio}</p><span className="news-expert-stats">{row.follower_count.toLocaleString('vi-VN')} người theo dõi · {row.article_count} bài viết</span></span><span className={`status ${row.is_active ? 'success' : 'danger'}`}>{row.is_active ? 'Đang hoạt động' : 'Đã tắt'}</span><button className="icon-button" onClick={() => onEdit(row)}><Pencil size={16} /></button></article>)}</div></section>;
}

function ExpertForm({ value, onChange, onSubmit, onClose }: { value: typeof emptyExpert & { id?: string }; onChange: (value: typeof emptyExpert & { id?: string }) => void; onSubmit: (event: React.FormEvent) => void; onClose: () => void }) {
  return <form className="news-editor" onSubmit={onSubmit}><header><span><h2>{value.id ? 'Chỉnh sửa chuyên gia' : 'Thêm chuyên gia'}</h2><p>Thông tin hồ sơ dùng trên Tường, Tìm kiếm và Hồ sơ chuyên gia.</p></span><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></header><div className="news-editor-grid"><label>Tên chuyên gia<input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value, slug: value.slug || slugify(event.target.value) })} required /></label><label>Đường dẫn<input value={value.slug} onChange={(event) => onChange({ ...value, slug: slugify(event.target.value) })} required /></label><label>Chữ đại diện<input value={value.initials} maxLength={4} onChange={(event) => onChange({ ...value, initials: event.target.value.toUpperCase() })} /></label><label className="wide-field">Chuyên môn<input value={value.specialty} onChange={(event) => onChange({ ...value, specialty: event.target.value })} required /></label><label className="wide-field">Giới thiệu<textarea value={value.bio} onChange={(event) => onChange({ ...value, bio: event.target.value })} required /></label><label>Ảnh đại diện<input type="url" value={value.avatar_url} onChange={(event) => onChange({ ...value, avatar_url: event.target.value })} placeholder="https://..." /></label><label>Ảnh bìa<input type="url" value={value.cover_url} onChange={(event) => onChange({ ...value, cover_url: event.target.value })} placeholder="https://..." /></label><label>Thứ tự<input type="number" min="0" value={value.sort_order} onChange={(event) => onChange({ ...value, sort_order: Number(event.target.value) })} /></label><label className="news-check"><input type="checkbox" checked={value.is_verified} onChange={(event) => onChange({ ...value, is_verified: event.target.checked })} /> Đã xác minh chuyên môn</label><label className="news-check"><input type="checkbox" checked={value.is_active} onChange={(event) => onChange({ ...value, is_active: event.target.checked })} /> Đang hoạt động</label></div><div className="form-actions"><button type="button" className="outline-button" onClick={onClose}>Hủy</button><button className="primary-button">Lưu chuyên gia</button></div></form>;
}

function TopicList({ rows, onEdit }: { rows: NewsTopic[]; onEdit: (row: NewsTopic) => void }) {
  return <section className="work-panel"><div className="table-heading"><h2>Lĩnh vực quan tâm</h2><p>Người dùng chọn các lĩnh vực này để cá nhân hóa bảng tin.</p></div><div className="topic-grid">{rows.map((row) => <article key={row.id}><span className="topic-icon"><Tags size={18} /></span><span><strong>{row.name}</strong><small>/{row.slug} · {row._count?.articles ?? 0} bài viết · {row._count?.interests ?? 0} người quan tâm</small></span><span className={`status ${row.isActive ? 'success' : 'danger'}`}>{row.isActive ? 'Đang dùng' : 'Đã tắt'}</span><button className="icon-button" onClick={() => onEdit(row)}><Pencil size={16} /></button></article>)}</div></section>;
}

function TopicForm({ value, onChange, onSubmit, onClose }: { value: typeof emptyTopic & { id?: string }; onChange: (value: typeof emptyTopic & { id?: string }) => void; onSubmit: (event: React.FormEvent) => void; onClose: () => void }) {
  return <form className="news-editor compact" onSubmit={onSubmit}><header><span><h2>{value.id ? 'Chỉnh sửa lĩnh vực' : 'Thêm lĩnh vực'}</h2></span><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></header><div className="news-editor-grid"><label>Tên lĩnh vực<input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value, slug: value.slug || slugify(event.target.value) })} required /></label><label>Đường dẫn<input value={value.slug} onChange={(event) => onChange({ ...value, slug: slugify(event.target.value) })} required /></label><label>Thứ tự<input type="number" min="0" value={value.sort_order} onChange={(event) => onChange({ ...value, sort_order: Number(event.target.value) })} /></label><label className="news-check"><input type="checkbox" checked={value.is_active} onChange={(event) => onChange({ ...value, is_active: event.target.checked })} /> Đang hoạt động</label></div><div className="form-actions"><button type="button" className="outline-button" onClick={onClose}>Hủy</button><button className="primary-button">Lưu lĩnh vực</button></div></form>;
}
