import { ArrowLeft, FileBadge2, Search } from 'lucide-react';
import { useState } from 'react';
import { api, type KycRow } from '../api';
import { statusDisplay } from '../status';

export function KycDetailPage({ row, onBack }: { row?: KycRow; onBack: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [currentStatus, setCurrentStatus] = useState(row?.status);
  if (!row) return <div className="page"><button className="back-button" onClick={onBack}><ArrowLeft /> Quay lại</button><p>Chọn một hồ sơ từ trang Tổng quan.</p></div>;

  async function review(status: 'APPROVED' | 'REJECTED') {
    setBusy(true); setMessage('');
    try { await api.reviewKyc(row!.id, status, note); setCurrentStatus(status); setMessage(status === 'APPROVED' ? 'Đã phê duyệt hồ sơ.' : 'Đã từ chối hồ sơ.'); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Không thể cập nhật hồ sơ'); }
    finally { setBusy(false); }
  }

  const fields = [
    ['Họ và tên', row.fullName], ['Ngày sinh', new Date(row.dateOfBirth).toLocaleDateString('vi-VN')],
    ['Số giấy tờ', row.idCardNumber], ['Số điện thoại', row.phoneNumber], ['Email', row.user.email], ['Địa chỉ', row.address],
    ['Ngân hàng', row.bankName || 'Chưa cung cấp'], ['Số tài khoản', row.bankAccountNumber || 'Chưa cung cấp'],
  ];
  const display = statusDisplay(currentStatus || row.status);

  return <div className="page kyc-page">
    <button className="back-button" onClick={onBack}><ArrowLeft size={18} /> Quay lại</button>
    <div className="breadcrumb">Người dùng &amp; KYC <span>/</span> Chi tiết hồ sơ</div>
    <div className="title-row"><h1>Chi tiết hồ sơ KYC</h1><span className={`status ${display.tone}`}>{display.label}</span></div>
    <section className="detail-section"><h2>Thông tin người dùng</h2><dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    <section className="detail-section"><h2>Giấy tờ tùy thân</h2><div className="documents"><Document label="Mặt trước giấy tờ" url={row.idFrontFileUrl} /><Document label="Mặt sau giấy tờ" url={row.idBackFileUrl} />{row.selfieFileUrl ? <Document label="Ảnh selfie cầm giấy tờ" url={row.selfieFileUrl} /> : null}</div></section>
    <section className="detail-section"><h2>Lịch sử hồ sơ</h2><div className="timeline"><span className="timeline-active"><FileBadge2 /> Gửi hồ sơ<small>{new Date(row.createdAt).toLocaleString('vi-VN')}</small></span><i /><span>Đang chờ duyệt</span><i /><span>Hoàn tất</span></div></section>
    {currentStatus === 'PENDING' ? <section className="review-section"><label htmlFor="review-note">Ghi chú duyệt</label><textarea id="review-note" maxLength={500} placeholder="Nhập ghi chú của bạn..." value={note} onChange={(event) => setNote(event.target.value)} /><small>{note.length}/500</small></section> : <section className="review-summary"><strong>Kết quả xử lý</strong><span>{row.reviewNote || row.rejectionReason || message || 'Hồ sơ đã được xử lý.'}</span></section>}
    {message ? <div className="review-message">{message}</div> : null}
    {currentStatus === 'PENDING' ? <div className="review-actions"><button className="reject-button" disabled={busy || !note.trim()} onClick={() => void review('REJECTED')}>Từ chối</button><button className="primary-button" disabled={busy} onClick={() => void review('APPROVED')}>Phê duyệt hồ sơ</button></div> : null}
  </div>;
}

function Document({ label, url }: { label: string; url: string }) {
  return <figure><figcaption>{label}</figcaption><div className="document-preview">{url ? <img src={url} alt={label} /> : <><FileBadge2 size={52} /><span>Ảnh giấy tờ được bảo vệ</span></>}<button type="button" aria-label={`Phóng to ${label}`} disabled={!url} onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}><Search size={18} /></button></div></figure>;
}
