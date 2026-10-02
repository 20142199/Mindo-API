import { afterEach, describe, expect, it, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { buildVietQrQuickLink, generateNumericOrderId, VietQrService } from './vietqr.service';

const originalEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe('VietQrService', () => {
  const service = () => new VietQrService(new JwtService());

  it('builds an encoded VietQR quick link', () => {
    const url = buildVietQrQuickLink('970436', '123456', 250000, 'MI TEST 01', 'MINDO COMPANY');
    expect(url).toContain('970436-123456-compact2.png');
    expect(url).toContain('amount=250000');
    expect(url).toContain('addInfo=MI+TEST+01');
  });

  it('generates a stable response without calling an upstream in quicklink mode', async () => {
    Object.assign(process.env, {
      VIETQR_MODE: 'quicklink',
      VIETQR_BANK_CODE: '970436',
      VIETQR_BANK_NAME: 'Vietcombank',
      VIETQR_BANK_ACCOUNT: '123456789',
      VIETQR_ACCOUNT_NAME: 'MINDO COMPANY',
    });
    const result = await service().generate(100000, 'MI123', '12345678901234');
    expect(result.provider).toBe('vietqr_quicklink');
    expect(result.order_id).toBe('12345678901234');
    expect(result.qr_code).toContain('amount=100000');
  });

  it('creates a 14-digit provider order id', () => {
    expect(generateNumericOrderId(1_700_000_000_000, 42)).toBe('1700000000042');
    expect(generateNumericOrderId(1_700_000_000_000, 1_042)).toBe('1700000000042');
  });

  it('asks VietQR to reconcile API-generated QR transactions', async () => {
    Object.assign(process.env, {
      VIETQR_MODE: 'api',
      VIETQR_BASE_URL: 'https://dev.vietqr.org',
      VIETQR_USERNAME: 'uat-user',
      VIETQR_PASSWORD: 'uat-password',
      VIETQR_ALLOW_QUICKLINK_FALLBACK: 'false',
      VIETQR_BANK_CODE: 'MB',
      VIETQR_BANK_NAME: 'MBBank',
      VIETQR_BANK_ACCOUNT: '0387002727',
      VIETQR_ACCOUNT_NAME: 'NGUYEN THI BANG SUONG',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'uat-token', token_type: 'Bearer', expires_in: 300 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        qrCode: '000201010212...', orderId: '17909239139644', existing: 0,
      }), { status: 200 }));

    await service().generate(10_000, 'MINDOUAT01', '17909239139644');

    const request = fetchMock.mock.calls[1][1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      bankCode: 'MB', bankAccount: '0387002727', amount: 10_000,
      orderId: '17909239139644', transType: 'C', reconciliation: true,
    });
  });

  it('issues and validates the Bearer token used by VietQR callbacks', async () => {
    Object.assign(process.env, {
      VIETQR_CALLBACK_USERNAME: 'mindo-vietqr',
      VIETQR_CALLBACK_PASSWORD: 'callback-password',
      VIETQR_CALLBACK_JWT_SECRET: 'callback-jwt-secret-at-least-32-characters',
      VIETQR_CALLBACK_TOKEN_TTL_SECONDS: '600',
    });
    const vietQr = service();
    const authorization = `Basic ${Buffer.from('mindo-vietqr:callback-password').toString('base64')}`;
    const issued = await vietQr.issueCallbackToken(authorization);
    expect(issued.token_type).toBe('Bearer');
    expect(issued.expires_in).toBe(600);
    await expect(vietQr.assertCallbackAuthorization(`Bearer ${issued.access_token}`)).resolves.toBeUndefined();
  });
});
