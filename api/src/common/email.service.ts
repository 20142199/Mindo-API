import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export type OtpPurpose = 'register' | 'reset';

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export function renderOtpEmail(otp: string, purpose: OtpPurpose, expiryMinutes: number) {
  const action = purpose === 'register' ? 'xác nhận tài khoản' : 'đặt lại mật khẩu';
  return [
    '<!doctype html><html lang="vi">',
    '<body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#101828">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #dbe3f0;border-radius:12px"><tr><td style="padding:28px">',
    '<div style="font-size:20px;font-weight:700;color:#174ea6">Mindo</div>',
    '<h1 style="margin:24px 0 10px;font-size:24px">Mã xác thực OTP</h1>',
    '<p style="margin:0;color:#53627a;line-height:1.6">Dùng mã dưới đây để ' + action + '. Mã có hiệu lực trong ' + expiryMinutes + ' phút.</p>',
    '<div style="margin:24px 0;padding:16px;text-align:center;background:#e8f0fe;border-radius:8px;color:#174ea6;font-size:32px;font-weight:700;letter-spacing:8px">' + escapeHtml(otp) + '</div>',
    '<p style="margin:0;color:#667085;font-size:13px;line-height:1.6">Nếu bạn không yêu cầu mã này, hãy bỏ qua email. Không chia sẻ OTP cho bất kỳ ai.</p>',
    '</td></tr></table></td></tr></table></body></html>',
  ].join('');
}

@Injectable()
export class EmailService {
  private readonly transporter: nodemailer.Transporter;

  constructor() {
    const user = process.env.SMTP_USER;
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: process.env.SMTP_SECURE === 'true',
      auth: user ? { user, pass: process.env.SMTP_PASSWORD ?? '' } : undefined,
      connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS ?? 10_000),
    });
  }

  async sendOtp(to: string, otp: string, purpose: OtpPurpose, expiryMinutes: number) {
    const subject = purpose === 'register' ? 'Mã xác nhận tài khoản Mindo' : 'Mã đặt lại mật khẩu Mindo';
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM ?? '"Mindo" <no-reply@mindo.local>',
        to,
        subject,
        html: renderOtpEmail(otp, purpose, expiryMinutes),
      });
    } catch {
      throw new ServiceUnavailableException('Chưa thể gửi email OTP. Vui lòng thử lại sau');
    }
  }

  async sendLoginAlert(to: string, device: string, ipAddress?: string, location?: string) {
    const details = [
      `<strong>Thiết bị:</strong> ${escapeHtml(device)}`,
      ipAddress ? `<strong>Địa chỉ IP:</strong> ${escapeHtml(ipAddress)}` : '',
      location ? `<strong>Vị trí:</strong> ${escapeHtml(location)}` : '',
    ].filter(Boolean).join('<br>');
    await this.transporter.sendMail({
      from: process.env.SMTP_FROM ?? '"Mindo" <no-reply@mindo.local>',
      to,
      subject: 'Cảnh báo đăng nhập mới vào tài khoản Mindo',
      html: [
        '<!doctype html><html lang="vi">',
        '<body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#0b2858">',
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">',
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #dbe3f0;border-radius:12px"><tr><td style="padding:28px">',
        '<div style="font-size:20px;font-weight:700">Mindo</div>',
        '<h1 style="margin:24px 0 10px;font-size:24px">Phát hiện đăng nhập mới</h1>',
        '<p style="color:#53627a;line-height:1.6">Tài khoản của bạn vừa được đăng nhập từ một thiết bị hoặc địa chỉ IP mới.</p>',
        `<p style="line-height:1.8">${details}</p>`,
        '<p style="color:#667085;font-size:13px;line-height:1.6">Nếu đây không phải bạn, hãy đổi mật khẩu và đăng xuất tất cả thiết bị ngay.</p>',
        '</td></tr></table></td></tr></table></body></html>',
      ].join(''),
    });
  }
}
