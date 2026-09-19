import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomInt, timingSafeEqual } from 'node:crypto';

export type VietQrResult = {
  provider: 'vietqr_api' | 'vietqr_quicklink' | 'vietqr_quicklink_fallback';
  bank_code: string;
  bank_name: string;
  bank_account: string;
  user_bank_name: string;
  amount: number;
  content: string;
  order_id: string;
  qr_code: string;
  raw?: Record<string, unknown>;
};

type VietQrToken = { accessToken: string; tokenType: string; expiresAt: number };

export function generateNumericOrderId(now = Date.now(), suffix = randomInt(0, 10_000)) {
  return `${Math.floor(now / 1000)}${suffix.toString().padStart(4, '0')}`;
}

export function buildVietQrQuickLink(bankId: string, account: string, amount: number, content: string, accountName: string) {
  const query = new URLSearchParams({
    amount: Math.round(amount).toString(),
    addInfo: content,
    accountName,
  });
  return `https://img.vietqr.io/image/${encodeURIComponent(bankId)}-${encodeURIComponent(account)}-compact2.png?${query.toString()}`;
}

@Injectable()
export class VietQrService {
  private token?: VietQrToken;

  constructor(private readonly jwt: JwtService) {}

  async generate(amount: number, content: string, orderId = generateNumericOrderId()): Promise<VietQrResult> {
    const bankCode = process.env.VIETQR_BANK_CODE ?? process.env.VIETQR_BANK_ID ?? '';
    const bankName = process.env.VIETQR_BANK_NAME ?? bankCode;
    const bankAccount = process.env.VIETQR_BANK_ACCOUNT ?? '';
    const accountName = process.env.VIETQR_ACCOUNT_NAME ?? '';
    if (!bankCode || !bankAccount || !accountName) {
      throw new BadRequestException('Chưa cấu hình tài khoản ngân hàng VietQR');
    }

    if (process.env.VIETQR_MODE === 'api') {
      try {
        return await this.generateViaApi({ amount, content, orderId, bankCode, bankName, bankAccount, accountName });
      } catch (error) {
        if (process.env.VIETQR_ALLOW_QUICKLINK_FALLBACK === 'false') throw error;
        return this.quickLink('vietqr_quicklink_fallback', amount, content, orderId, bankCode, bankName, bankAccount, accountName);
      }
    }
    return this.quickLink('vietqr_quicklink', amount, content, orderId, bankCode, bankName, bankAccount, accountName);
  }

  assertWebhookSecret(value?: string) {
    const configured = process.env.VIETQR_WEBHOOK_SECRET;
    if (!configured || !value) throw new UnauthorizedException('Webhook VietQR không hợp lệ');
    const expected = Buffer.from(configured);
    const supplied = Buffer.from(value);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new UnauthorizedException('Webhook VietQR không hợp lệ');
    }
  }

  async issueCallbackToken(authorization?: string) {
    const match = authorization?.match(/^Basic\s+(.+)$/i);
    if (!match) throw new UnauthorizedException('Thông tin xác thực VietQR không hợp lệ');
    let suppliedUsername = '';
    let suppliedPassword = '';
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator < 1) throw new Error('invalid basic auth');
      suppliedUsername = decoded.slice(0, separator);
      suppliedPassword = decoded.slice(separator + 1);
    } catch {
      throw new UnauthorizedException('Thông tin xác thực VietQR không hợp lệ');
    }
    const username = process.env.VIETQR_CALLBACK_USERNAME;
    const password = process.env.VIETQR_CALLBACK_PASSWORD;
    const secret = this.callbackJwtSecret();
    if (!username || !password || !secret || !this.safeEqual(username, suppliedUsername) || !this.safeEqual(password, suppliedPassword)) {
      throw new UnauthorizedException('Thông tin xác thực VietQR không hợp lệ');
    }
    const expiresIn = Number(process.env.VIETQR_CALLBACK_TOKEN_TTL_SECONDS ?? 3600);
    const accessToken = await this.jwt.signAsync(
      { sub: 'vietqr', scope: 'transaction-sync' },
      { secret, expiresIn },
    );
    return { access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn };
  }

  async assertCallbackAuthorization(authorization?: string, webhookSecret?: string) {
    if (authorization?.match(/^Bearer\s+/i)) {
      const token = authorization.replace(/^Bearer\s+/i, '').trim();
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string; scope: string }>(token, { secret: this.callbackJwtSecret() });
        if (payload.sub === 'vietqr' && payload.scope === 'transaction-sync') return;
      } catch {
        // Return the same generic response for all malformed or expired tokens.
      }
      throw new UnauthorizedException('Bearer token VietQR không hợp lệ');
    }
    this.assertWebhookSecret(webhookSecret);
  }

  private quickLink(
    provider: VietQrResult['provider'],
    amount: number,
    content: string,
    orderId: string,
    bankCode: string,
    bankName: string,
    bankAccount: string,
    accountName: string,
  ): VietQrResult {
    return {
      provider,
      bank_code: bankCode,
      bank_name: bankName,
      bank_account: bankAccount,
      user_bank_name: accountName,
      amount,
      content,
      order_id: orderId,
      qr_code: buildVietQrQuickLink(bankCode, bankAccount, amount, content, accountName),
    };
  }

  private async generateViaApi(input: {
    amount: number;
    content: string;
    orderId: string;
    bankCode: string;
    bankName: string;
    bankAccount: string;
    accountName: string;
  }): Promise<VietQrResult> {
    const baseUrl = (process.env.VIETQR_BASE_URL ?? '').replace(/\/$/, '');
    const username = process.env.VIETQR_USERNAME ?? '';
    const password = process.env.VIETQR_PASSWORD ?? '';
    if (!baseUrl || !username || !password) throw new ServiceUnavailableException('Thiếu cấu hình API VietQR');
    const token = await this.getToken(baseUrl, username, password);
    const response = await fetch(`${baseUrl}/vqr/api/qr/generate-customer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `${token.tokenType} ${token.accessToken}` },
      body: JSON.stringify({
        bankCode: input.bankCode,
        bankAccount: input.bankAccount,
        userBankName: input.accountName,
        content: input.content,
        qrType: 0,
        amount: Math.round(input.amount),
        orderId: input.orderId,
        transType: 'C',
      }),
      signal: AbortSignal.timeout(Number(process.env.VIETQR_TIMEOUT_MS ?? 10_000)),
    });
    if (!response.ok) throw new ServiceUnavailableException('VietQR chưa thể tạo mã thanh toán');
    const raw = await response.json() as Record<string, unknown>;
    const qrCode = String(raw.qrCode ?? raw.qr_code ?? raw.urlLink ?? '');
    if (!qrCode) throw new ServiceUnavailableException('VietQR không trả về mã QR');
    return {
      provider: 'vietqr_api',
      bank_code: String(raw.bankCode ?? input.bankCode),
      bank_name: String(raw.bankName ?? input.bankName),
      bank_account: String(raw.bankAccount ?? input.bankAccount),
      user_bank_name: String(raw.userBankName ?? input.accountName),
      amount: Number(raw.amount ?? input.amount),
      content: String(raw.content ?? input.content),
      order_id: String(raw.orderId ?? input.orderId),
      qr_code: qrCode,
      raw,
    };
  }

  private async getToken(baseUrl: string, username: string, password: string) {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token;
    const response = await fetch(`${baseUrl}/vqr/api/token_generate`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
      signal: AbortSignal.timeout(Number(process.env.VIETQR_TIMEOUT_MS ?? 10_000)),
    });
    if (!response.ok) throw new ServiceUnavailableException('Không đăng nhập được VietQR');
    const data = await response.json() as { access_token?: string; token_type?: string; expires_in?: number };
    if (!data.access_token) throw new ServiceUnavailableException('Token VietQR không hợp lệ');
    this.token = {
      accessToken: data.access_token,
      tokenType: data.token_type ?? 'Bearer',
      expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    };
    return this.token;
  }

  private callbackJwtSecret() {
    return process.env.VIETQR_CALLBACK_JWT_SECRET ?? process.env.VIETQR_WEBHOOK_SECRET ?? '';
  }

  private safeEqual(expected: string, supplied: string) {
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
  }
}
