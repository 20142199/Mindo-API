import { ArrowLeft, FileBadge2, Search } from 'lucide-react';
import { useState } from 'react';
import { api, type KycRow } from '../api';

export function KycDetailPage({ row, onBack }: { row?: KycRow; onBack: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!row) return <div className="page"><button className="back-button" onClick={onBack}><ArrowLeft /> Quay lại</button><p>Chọn một hồ sơ từ trang Tổng quan.</p></div>;

  async function review(status: 'APPROVED' | 'REJECTED') {
    setBusy(true); setMessage('');
    try { await api.reviewKyc(row!.id, status, note); setMessage(status === 'APPROVED' ? 'Đã phê duyệt hồ sơ.' : 'Đã từ chối hồ sơ.'); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Không thể cập nhật hồ sơ'); }
    finally { setBusy(false); }
  }

  const fields = [
    ['Họ và tên', row.fullName], ['Ngày sinh', new Date(row.dateOfBirth).toLocaleDateString('vi-VN')],
    ['Số giấy tờ', row.idCardNumber], ['Số điện thoại', row.phoneNumber], ['Email', row.user.email], ['Địa chỉ', row.address],
  ];

  return <div className="page kyc-page">
    <button className="back-button" onClick={onBack}><ArrowLeft size={18} /> Quay lại</button>
    <div className="breadcrumb">Người dùng &amp; KYC <span>/</span> Chi tiết hồ sơ</div>
    <div className="title-row"><h1>Chi tiết hồ sơ KYC</h1><span className="status warning">Chờ duyệt</span></div>
    <section className="detail-section"><h2>Thông tin người dùng</h2><dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    <section className="detail-section"><h2>Giấy tờ tùy thân</h2><div className="documents"><Document label="Mặt trước giấy tờ" url={row.idFrontFileUrl} /><Document label="Mặt sau giấy tờ" url={row.idBackFileUrl} /></div></section>
    <section className="detail-section"><h2>Lịch sử hồ sơ</h2><div className="timeline"><span className="timeline-active"><FileBadge2 /> Gửi hồ sơ<small>{new Date(row.createdAt).toLocaleString('vi-VN')}</small></span><i /><span>Đang chờ duyệt</span><i /><span>Hoàn tất</span></div></section>
    <section className="review-section"><label htmlFor="review-note">Ghi chú duyệt</label><textarea id="review-note" maxLength={500} placeholder="Nhập ghi chú của bạn..." value={note} onChange={(event) => setNote(event.target.value)} /><small>{note.length}/500</small></section>
    {message ? <div className="review-message">{message}</div> : null}
    <div className="review-actions"><button className="reject-button" disabled={busy || !note.trim()} onClick={() => void review('REJECTED')}>Từ chối</button><button className="primary-button" disabled={busy} onClick={() => void review('APPROVED')}>Phê duyệt hồ sơ</button></div>
  </div>;
}

function Document({ label, url }: { label: string; url: string }) {
  return <figure><figcaption>{label}</figcaption><div className="document-preview">{url ? <img src={url} alt={label} /> : <><FileBadge2 size={52} /><span>Ảnh giấy tờ được bảo vệ</span></>}<button aria-label={`Phóng to ${label}`}><Search size={18} /></button></div></figure>;
}
