import { Injectable, Logger } from '@nestjs/common';

type TelegramWithdrawalInput = {
  id: string;
  amountVnd: string;
  customerName: string;
  customerEmail: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
};

@Injectable()
export class TelegramNotificationService {
  private readonly logger = new Logger(TelegramNotificationService.name);

  isConfigured() {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());
  }

  notifyDepositConfirmed(input: {
    id: string;
    amountVnd: string;
    customerName: string;
    customerEmail: string;
    transferCode: string;
    bankTransactionId: string;
  }) {
    return this.send([
      '✅ MINDO — NẠP TIỀN THÀNH CÔNG',
      `Số tiền: ${this.money(input.amountVnd)}`,
      `Khách hàng: ${input.customerName} (${input.customerEmail})`,
      `Mã nạp: ${input.transferCode}`,
      `Mã ngân hàng: ${input.bankTransactionId}`,
      `ID: ${input.id}`,
    ].join('\n'));
  }

  notifyWithdrawalCreated(input: TelegramWithdrawalInput) {
    return this.send([
      '⏳ MINDO — CÓ LỆNH RÚT CHỜ DUYỆT',
      `Số tiền: ${this.money(input.amountVnd)}`,
      `Khách hàng: ${input.customerName} (${input.customerEmail})`,
      `Nhận tại: ${input.bankName} - ${input.bankAccountNumber}`,
      `Chủ tài khoản: ${input.bankAccountName}`,
      `ID: ${input.id}`,
    ].join('\n'));
  }

  notifyWithdrawalReviewed(input: TelegramWithdrawalInput & {
    status: 'APPROVED' | 'REJECTED';
    reviewerName: string;
    reviewerEmail: string;
    transactionCode?: string;
    reason?: string;
  }) {
    const approved = input.status === 'APPROVED';
    return this.send([
      `${approved ? '✅' : '❌'} MINDO — LỆNH RÚT ${approved ? 'ĐÃ CHUYỂN TIỀN' : 'ĐÃ TỪ CHỐI'}`,
      `Số tiền: ${this.money(input.amountVnd)}`,
      `Khách hàng: ${input.customerName} (${input.customerEmail})`,
      `Người xử lý: ${input.reviewerName} (${input.reviewerEmail})`,
      approved ? `Mã giao dịch: ${input.transactionCode ?? '—'}` : `Lý do: ${input.reason ?? '—'}`,
      `ID: ${input.id}`,
    ].join('\n'));
  }

  private async send(text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
    if (!token || !chatId) return { configured: false, sent: false };
    try {
      const threadId = process.env.TELEGRAM_THREAD_ID?.trim();
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text.slice(0, 4096),
          disable_web_page_preview: true,
          ...(threadId ? { message_thread_id: Number(threadId) } : {}),
        }),
        signal: AbortSignal.timeout(Number(process.env.TELEGRAM_TIMEOUT_MS ?? 5_000)),
      });
      if (!response.ok) {
        this.logger.warn(`Telegram trả HTTP ${response.status}; nghiệp vụ chính vẫn được giữ nguyên`);
        return { configured: true, sent: false };
      }
      return { configured: true, sent: true };
    } catch (error) {
      this.logger.warn(`Không gửi được Telegram; nghiệp vụ chính vẫn thành công: ${error instanceof Error ? error.message : String(error)}`);
      return { configured: true, sent: false };
    }
  }

  private money(value: string) {
    const amount = Number(value);
    return Number.isFinite(amount) ? `${amount.toLocaleString('vi-VN')} VND` : `${value} VND`;
  }
}
