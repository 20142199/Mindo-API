import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramNotificationService } from './telegram-notification.service';

describe('TelegramNotificationService', () => {
  const service = new TelegramNotificationService();

  beforeEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_THREAD_ID;
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does nothing when Telegram is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.notifyWithdrawalCreated({
      id: 'wd-1', amountVnd: '500000', customerName: 'Khách hàng', customerEmail: 'user@mindo.vn',
      bankName: 'ACB', bankAccountNumber: '13989647', bankAccountName: 'TRAN DUY HUNG',
    })).resolves.toEqual({ configured: false, sent: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a plain-text message and never exposes the bot token in the payload', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot-secret';
    process.env.TELEGRAM_CHAT_ID = '-100123';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.notifyWithdrawalReviewed({
      id: 'wd-1', amountVnd: '500000', customerName: 'Khách hàng', customerEmail: 'user@mindo.vn',
      bankName: 'ACB', bankAccountNumber: '13989647', bankAccountName: 'TRAN DUY HUNG',
      status: 'APPROVED', reviewerName: 'Thủ quỹ', reviewerEmail: 'finance@mindo.vn', transactionCode: 'ACB-001',
    })).resolves.toEqual({ configured: true, sent: true });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(request.body)).toContain('ACB-001');
    expect(String(request.body)).not.toContain('bot-secret');
  });

  it('does not fail the money flow when Telegram is unavailable', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot-secret';
    process.env.TELEGRAM_CHAT_ID = '-100123';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(service.notifyDepositConfirmed({
      id: 'dep-1', amountVnd: '100000', customerName: 'Khách hàng', customerEmail: 'user@mindo.vn',
      transferCode: 'MI123', bankTransactionId: 'BANK-001',
    })).resolves.toEqual({ configured: true, sent: false });
  });
});
