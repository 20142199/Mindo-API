import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BadgeDollarSign, CalendarDays, CircleCheck, Download, HandCoins, PackageCheck, RefreshCw, UsersRound, WalletCards } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type AnalyticsReport } from '../api';

const currency = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('vi-VN');

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function initialRange(days = 30) {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days + 1);
  return { from: isoDate(from), to: isoDate(to) };
}

function bucketLabel(value: string) {
  if (value.length === 7) return `${value.slice(5)}/${value.slice(0, 4)}`;
  const [year, month, day] = value.split('-');
  return `${day}/${month}${year ? `/${year.slice(2)}` : ''}`;
}

export function AnalyticsPage() {
  const defaultRange = useMemo(() => initialRange(), []);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [preset, setPreset] = useState(30);
  const [report, setReport] = useState<AnalyticsReport>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.analytics(from, to, granularity)
      .then((data) => { if (active) setReport(data); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Không thể tải báo cáo'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to, granularity, refreshKey]);

  function usePreset(days: number) {
    const range = initialRange(days);
    setFrom(range.from);
    setTo(range.to);
    setGranularity(days > 90 ? 'month' : days > 31 ? 'week' : 'day');
    setPreset(days);
  }

  function exportCsv() {
    if (!report) return;
    const rows = [
      ['Báo cáo Mindo', `${report.period.from} - ${report.period.to}`],
      ['Chỉ số', 'Giá trị'],
      ['Tiền nạp đã xác nhận', report.summary.cash_flow.deposits_vnd],
      ['Tiền rút đã duyệt', report.summary.cash_flow.withdrawals_vnd],
      ['Dòng tiền ròng', report.summary.cash_flow.net_vnd],
      ['Doanh thu thuần', report.summary.sales.net_revenue_vnd],
      ['Chiết khấu', report.summary.sales.discounts_vnd],
      ['Peer đã bán', report.summary.sales.peer_sold],
      ['Tổng hoa hồng', report.summary.commissions.total_vnd],
      [],
      ['Kỳ', 'Nạp tiền', 'Rút tiền', 'Doanh thu', 'Hoa hồng', 'User mới', 'Peer bán'],
      ...report.timeseries.map((row) => [row.bucket, row.deposits_vnd, row.withdrawals_vnd, row.revenue_vnd, row.commissions_vnd, row.new_users, row.peer_sold]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `mindo-bao-cao-${report.period.from}-${report.period.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const summary = report?.summary;
  const comparison = report?.comparison;
  const cards = summary && comparison ? [
    { label: 'Tiền nạp đã xác nhận', value: currency.format(summary.cash_flow.deposits_vnd), detail: `${integer.format(summary.cash_flow.deposits_count)} giao dịch`, change: comparison.deposits_vnd, icon: WalletCards },
    { label: 'Tiền rút đã duyệt', value: currency.format(summary.cash_flow.withdrawals_vnd), detail: `${integer.format(summary.cash_flow.withdrawals_count)} giao dịch`, change: comparison.withdrawals_vnd, icon: HandCoins, inverse: true },
    { label: 'Doanh thu thuần', value: currency.format(summary.sales.net_revenue_vnd), detail: `Đã giảm ${currency.format(summary.sales.discounts_vnd)}`, change: comparison.net_revenue_vnd, icon: BadgeDollarSign },
    { label: 'Peer đã bán', value: integer.format(summary.sales.peer_sold), detail: `${integer.format(summary.sales.orders)} đơn hoàn tất`, change: comparison.peer_sold, icon: PackageCheck },
    { label: 'Người dùng mới', value: integer.format(summary.users.new_users), detail: `${integer.format(summary.users.kyc_approved)} KYC được duyệt`, change: comparison.new_users, icon: UsersRound },
    { label: 'Tổng hoa hồng', value: currency.format(summary.commissions.total_vnd), detail: `Còn ghi nhận ${currency.format(summary.commissions.earned_vnd)}`, change: comparison.commission_vnd, icon: Activity },
  ] : [];

  return <div className="page analytics-page">
    <header className="analytics-heading">
      <span><h1>Báo cáo & Thống kê</h1><p>Theo dõi sức khỏe kinh doanh, dòng tiền và các điểm cần đối soát trên cùng một màn hình.</p></span>
      <button className="outline-button" onClick={exportCsv} disabled={!report}><Download size={17} /> Xuất CSV</button>
    </header>

    <section className="analytics-filter" aria-label="Bộ lọc báo cáo">
      <div className="analytics-presets"><button className={preset === 7 ? 'active' : ''} onClick={() => usePreset(7)}>7 ngày</button><button className={preset === 30 ? 'active' : ''} onClick={() => usePreset(30)}>30 ngày</button><button className={preset === 90 ? 'active' : ''} onClick={() => usePreset(90)}>90 ngày</button><button className={preset === 365 ? 'active' : ''} onClick={() => usePreset(365)}>12 tháng</button></div>
      <label><span>Từ ngày</span><input type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPreset(0); }} /></label>
      <label><span>Đến ngày</span><input type="date" value={to} min={from} onChange={(event) => { setTo(event.target.value); setPreset(0); }} /></label>
      <label><span>Nhóm theo</span><select value={granularity} onChange={(event) => setGranularity(event.target.value as typeof granularity)}><option value="day">Ngày</option><option value="week">Tuần</option><option value="month">Tháng</option></select></label>
      <button className="analytics-refresh" aria-label="Làm mới báo cáo" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={18} className={loading ? 'spinning' : ''} /></button>
    </section>

    {error ? <div className="error-banner">{error}</div> : null}
    {loading && !report ? <AnalyticsSkeleton /> : null}
    {report ? <>
      <section className="analytics-kpis" aria-label="Chỉ số chính">
        {cards.map(({ label, value, detail, change, icon: Icon, inverse }) => <article className="analytics-kpi" key={label}>
          <header><span className="analytics-kpi-icon"><Icon size={20} /></span><Change value={change} inverse={inverse} /></header>
          <small>{label}</small><strong>{value}</strong><p>{detail}</p>
        </article>)}
      </section>

      <section className="analytics-chart-grid">
        <TrendChart title="Dòng tiền nạp / rút" subtitle="Chỉ tính lệnh đã xác nhận hoặc đã duyệt" rows={report.timeseries} lines={[{ key: 'deposits_vnd', label: 'Nạp tiền', color: '#174c91' }, { key: 'withdrawals_vnd', label: 'Rút tiền', color: '#d98c27' }]} />
        <TrendChart title="Doanh thu / hoa hồng" subtitle="Đơn hoàn tất và hoa hồng đã ghi nhận" rows={report.timeseries} lines={[{ key: 'revenue_vnd', label: 'Doanh thu', color: '#58700d' }, { key: 'commissions_vnd', label: 'Hoa hồng', color: '#7a5fc0' }]} />
      </section>

      <section className="analytics-detail-grid">
        <article className="analytics-panel">
          <PanelTitle title="Hiệu quả bán hàng" description="Giá niêm yết, chiết khấu và giá trị thực thu" />
          <MetricLine label="Doanh thu gộp" value={currency.format(summary!.sales.gross_revenue_vnd)} />
          <MetricLine label="Chiết khấu sản phẩm" value={`− ${currency.format(summary!.sales.discounts_vnd)}`} tone="warning" />
          <MetricLine label="Doanh thu thuần" value={currency.format(summary!.sales.net_revenue_vnd)} strong />
          <MetricLine label="Giá trị đơn trung bình" value={currency.format(summary!.sales.average_order_vnd)} />
        </article>
        <article className="analytics-panel">
          <PanelTitle title="Người dùng trong kỳ" description="Tăng trưởng, xác minh và phát sinh giao dịch" />
          <FunnelRow label="Đăng ký mới" value={summary!.users.new_users} total={Math.max(summary!.users.new_users, 1)} />
          <FunnelRow label="KYC được duyệt" value={summary!.users.kyc_approved} total={Math.max(summary!.users.new_users, summary!.users.kyc_approved, 1)} />
          <FunnelRow label="Có mua Peer" value={summary!.users.transacting_users} total={Math.max(summary!.users.new_users, summary!.users.transacting_users, 1)} />
          <p className="analytics-panel-note">Tổng tài khoản nhà đầu tư: <strong>{integer.format(summary!.users.total_investors)}</strong></p>
        </article>
        <article className="analytics-panel">
          <PanelTitle title="Cơ cấu hoa hồng" description="Tách riêng từng cơ chế trả thưởng" />
          <MetricLine label="Giới thiệu F1" value={currency.format(summary!.commissions.direct_vnd)} />
          <MetricLine label="Thưởng đầu nhánh" value={currency.format(summary!.commissions.branch_vnd)} />
          <MetricLine label="Hoa hồng đại lý" value={currency.format(summary!.commissions.agency_vnd)} />
          <MetricLine label="Tổng cộng" value={currency.format(summary!.commissions.total_vnd)} strong />
        </article>
        <article className="analytics-panel analytics-alert-panel">
          <PanelTitle title="Cảnh báo đối soát" description="Các tình huống cần đội vận hành kiểm tra" />
          <div className="analytics-alert-list">{report.alerts.map((alert) => <div className={`analytics-alert ${alert.level}`} key={alert.key}>
            <span>{alert.level === 'ok' ? <CircleCheck size={18} /> : <AlertTriangle size={18} />}</span>
            <p><strong>{alert.label}</strong><small>{alert.count ? `${integer.format(alert.count)} lệnh · ${currency.format(alert.amount_vnd)}` : 'Không có vấn đề'}</small></p>
          </div>)}</div>
        </article>
      </section>

      <section className="analytics-bottom-grid">
        <article className="analytics-panel">
          <PanelTitle title="Doanh thu theo danh hiệu" description="Phân bổ đơn hoàn tất theo cấp đại lý tại thời điểm mua" />
          <div className="agency-title-bars">{report.agency_titles.length ? report.agency_titles.map((row) => {
            const max = Math.max(...report.agency_titles.map((item) => item.revenue_vnd), 1);
            return <div key={row.title}><span><strong>{titleLabel(row.title)}</strong><small>{integer.format(row.peer_sold)} Peer</small></span><i><b style={{ width: `${Math.max((row.revenue_vnd / max) * 100, 2)}%` }} /></i><em>{currency.format(row.revenue_vnd)}</em></div>;
          }) : <p className="analytics-empty">Chưa có doanh thu theo danh hiệu trong kỳ.</p>}</div>
        </article>
        <article className="analytics-panel top-agency-panel">
          <PanelTitle title="Đại lý dẫn đầu" description="Xếp hạng theo doanh thu đơn hoàn tất trong kỳ" />
          <div className="analytics-table-scroll"><table><thead><tr><th>Đại lý</th><th>Đơn</th><th>Peer</th><th>Doanh thu</th></tr></thead><tbody>
            {report.top_agencies.map((row, index) => <tr key={row.id}><td><strong>{index + 1}. {row.name}</strong><small>{row.code} · {row.owner}</small></td><td>{integer.format(row.orders)}</td><td>{integer.format(row.peer_sold)}</td><td><strong>{currency.format(row.revenue_vnd)}</strong></td></tr>)}
            {!report.top_agencies.length ? <tr><td colSpan={4} className="empty">Chưa có đơn gắn với đại lý trong kỳ.</td></tr> : null}
          </tbody></table></div>
        </article>
      </section>
    </> : null}
  </div>;
}

function Change({ value, inverse = false }: { value: number | null; inverse?: boolean }) {
  if (value === null) return <span className="analytics-change neutral">Kỳ trước: 0</span>;
  if (value === 0) return <span className="analytics-change neutral">0%</span>;
  const positive = inverse ? value <= 0 : value >= 0;
  return <span className={`analytics-change ${positive ? 'positive' : 'negative'}`}>{value >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(value)}%</span>;
}

type SeriesKey = 'deposits_vnd' | 'withdrawals_vnd' | 'revenue_vnd' | 'commissions_vnd';
function TrendChart({ title, subtitle, rows, lines }: { title: string; subtitle: string; rows: AnalyticsReport['timeseries']; lines: Array<{ key: SeriesKey; label: string; color: string }> }) {
  const width = 720;
  const height = 230;
  const pad = { left: 18, right: 16, top: 22, bottom: 34 };
  const actualMax = Math.max(...rows.flatMap((row) => lines.map((line) => row[line.key])), 0);
  const max = Math.max(actualMax, 1);
  const points = (key: SeriesKey) => rows.map((row, index) => {
    const x = pad.left + (rows.length <= 1 ? 0 : index * (width - pad.left - pad.right) / (rows.length - 1));
    const y = pad.top + (height - pad.top - pad.bottom) * (1 - row[key] / max);
    return `${x},${y}`;
  }).join(' ');
  return <article className="analytics-panel analytics-chart">
    <header><PanelTitle title={title} description={subtitle} /><span className="analytics-chart-total">Cao nhất <strong>{compact.format(actualMax)}đ</strong></span></header>
    <div className="analytics-legend">{lines.map((line) => <span key={line.key}><i style={{ background: line.color }} />{line.label}</span>)}</div>
    <div className="analytics-svg-wrap">
      {rows.length ? <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} preserveAspectRatio="none">
        {[0, .25, .5, .75, 1].map((ratio) => <line key={ratio} x1={pad.left} x2={width - pad.right} y1={pad.top + ratio * (height - pad.top - pad.bottom)} y2={pad.top + ratio * (height - pad.top - pad.bottom)} className="chart-grid-line" />)}
        {lines.map((line) => <polyline key={line.key} points={points(line.key)} fill="none" stroke={line.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><title>{line.label}</title></polyline>)}
      </svg> : <p className="analytics-empty">Chưa có dữ liệu trong kỳ.</p>}
      {rows.length ? <div className="analytics-axis"><span>{bucketLabel(rows[0].bucket)}</span>{rows.length > 2 ? <span>{bucketLabel(rows[Math.floor(rows.length / 2)].bucket)}</span> : null}{rows.length > 1 ? <span>{bucketLabel(rows[rows.length - 1].bucket)}</span> : null}</div> : null}
    </div>
  </article>;
}

function PanelTitle({ title, description }: { title: string; description: string }) { return <span className="analytics-panel-title"><h2>{title}</h2><p>{description}</p></span>; }
function MetricLine({ label, value, strong = false, tone = '' }: { label: string; value: string; strong?: boolean; tone?: string }) { return <div className={`analytics-metric-line ${strong ? 'strong' : ''} ${tone}`}><span>{label}</span><b>{value}</b></div>; }
function FunnelRow({ label, value, total }: { label: string; value: number; total: number }) { return <div className="analytics-funnel"><span><strong>{label}</strong><b>{integer.format(value)}</b></span><i><b style={{ width: `${Math.min((value / total) * 100, 100)}%` }} /></i></div>; }
function titleLabel(title: string) { return title === 'TIER_1' ? 'Đại lý 1' : title === 'TIER_2' ? 'Đại lý 2' : title === 'TIER_3' ? 'Đại lý 3' : 'Khách hàng'; }
function AnalyticsSkeleton() { return <div className="analytics-skeleton"><span /><span /><span /><span /><span /><span /></div>; }
