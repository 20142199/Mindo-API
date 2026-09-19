import { Injectable, Logger } from '@nestjs/common';

export type CallSignalKind = 'call.invite' | 'call.accept' | 'call.reject' | 'call.cancel' | 'call.end' | 'call.missed';

@Injectable()
export class CallSignalingService {
  private readonly logger = new Logger(CallSignalingService.name);

  isConfigured() {
    return Boolean(
      process.env.AGORA_APP_ID?.trim()
      && process.env.AGORA_CUSTOMER_ID?.trim()
      && process.env.AGORA_CUSTOMER_SECRET?.trim(),
    );
  }

  async publish(params: {
    toUserId: string;
    fromUserId: string;
    kind: CallSignalKind;
    payload: Record<string, unknown>;
  }) {
    if (!this.isConfigured()) return false;
    const targets = [params.toUserId, `${params.toUserId}_web`];
    const results = await Promise.allSettled(targets.map((target) => this.send(target, params)));
    return results.some((result) => result.status === 'fulfilled' && result.value);
  }

  private async send(
    destination: string,
    params: { fromUserId: string; kind: CallSignalKind; payload: Record<string, unknown> },
  ) {
    const appId = process.env.AGORA_APP_ID!.trim();
    const customerId = process.env.AGORA_CUSTOMER_ID!.trim();
    const customerSecret = process.env.AGORA_CUSTOMER_SECRET!.trim();
    const url = `https://api.agora.io/dev/v2/project/${encodeURIComponent(appId)}/rtm/users/${encodeURIComponent(params.fromUserId)}/peer_messages`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${customerId}:${customerSecret}`).toString('base64')}`,
        },
        body: JSON.stringify({
          destination,
          enable_offline_messaging: false,
          enable_historical_messaging: false,
          payload: JSON.stringify({ v: 1, kind: params.kind, ...params.payload }),
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        this.logger.warn(`Agora RTM từ chối ${params.kind}: HTTP ${response.status}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`Không gửi được tín hiệu ${params.kind}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
