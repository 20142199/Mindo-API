import { afterEach, describe, expect, it } from 'vitest';
import { AgoraService } from './agora.service';
import { CallClient } from './call.dto';

const originalAppId = process.env.AGORA_APP_ID;
const originalCertificate = process.env.AGORA_APP_CERTIFICATE;

afterEach(() => {
  if (originalAppId === undefined) delete process.env.AGORA_APP_ID;
  else process.env.AGORA_APP_ID = originalAppId;
  if (originalCertificate === undefined) delete process.env.AGORA_APP_CERTIFICATE;
  else process.env.AGORA_APP_CERTIFICATE = originalCertificate;
});

describe('AgoraService', () => {
  it('creates RTC and platform-specific RTM credentials', () => {
    process.env.AGORA_APP_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    process.env.AGORA_APP_CERTIFICATE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const service = new AgoraService();
    const app = service.mediaCredentials('mindo-call-test', 'user-1', CallClient.APP);
    const web = service.rtmCredentials('user-1', CallClient.WEB);
    expect(app.rtc_uid).toBe('user-1');
    expect(app.rtm_uid).toBe('user-1');
    expect(app.rtc_token).toMatch(/^007/);
    expect(app.rtm_token).toMatch(/^007/);
    expect(web.rtm_uid).toBe('user-1_web');
  });
});
