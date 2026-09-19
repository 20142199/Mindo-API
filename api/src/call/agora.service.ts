import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RtcRole, RtcTokenBuilder, RtmTokenBuilder } from 'agora-token';
import { CallClient } from './call.dto';

@Injectable()
export class AgoraService {
  private get appId() { return process.env.AGORA_APP_ID?.trim() ?? ''; }
  private get certificate() { return process.env.AGORA_APP_CERTIFICATE?.trim() ?? ''; }
  private get ttlSeconds() {
    const configured = Number(process.env.AGORA_TOKEN_TTL_SECONDS ?? 86_400);
    return Number.isSafeInteger(configured) && configured >= 300 ? configured : 86_400;
  }

  isConfigured() {
    return Boolean(this.appId && this.certificate);
  }

  rtmCredentials(userId: string, client: CallClient) {
    this.assertConfigured();
    const uid = client === CallClient.WEB ? `${userId}_web` : userId;
    return {
      app_id: this.appId,
      rtm_uid: uid,
      rtm_token: RtmTokenBuilder.buildToken(this.appId, this.certificate, uid, this.ttlSeconds),
      expires_in: this.ttlSeconds,
    };
  }

  mediaCredentials(channelName: string, userId: string, client: CallClient) {
    this.assertConfigured();
    const rtm = this.rtmCredentials(userId, client);
    return {
      app_id: this.appId,
      channel_name: channelName,
      rtc_uid: userId,
      rtc_token: RtcTokenBuilder.buildTokenWithUserAccount(
        this.appId,
        this.certificate,
        channelName,
        userId,
        RtcRole.PUBLISHER,
        this.ttlSeconds,
        this.ttlSeconds,
      ),
      rtm_uid: rtm.rtm_uid,
      rtm_token: rtm.rtm_token,
      expires_in: this.ttlSeconds,
    };
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Dịch vụ gọi Mindo chưa được cấu hình Agora');
    }
  }
}
