import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging, type MulticastMessage } from 'firebase-admin/messaging';
import { PrismaService } from '../common/prisma.module';
import {
  chatPushMessage,
  incomingCallPushMessage,
  isDeadFirebaseTarget,
  type ChatPushInput,
  type IncomingCallPushInput,
} from './push-notification.domain';

@Injectable()
export class PushNotificationService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationService.name);
  private messaging?: Messaging;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const app = this.firebaseApp();
    if (!app) {
      this.logger.warn('FCM chưa có credentials; API quản lý device token vẫn hoạt động nhưng chưa gửi push');
      return;
    }
    this.messaging = getMessaging(app);
    this.logger.log('Firebase Cloud Messaging đã sẵn sàng');
  }

  isConfigured() {
    return Boolean(this.messaging);
  }

  async registerToken(userId: string, sessionId: string | undefined, token: string) {
    if (!sessionId) return false;
    const normalized = token.trim();
    const current = await this.prisma.refreshToken.findFirst({
      where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!current) return false;
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { fcmToken: normalized, id: { not: sessionId } },
        data: { fcmToken: null },
      }),
      this.prisma.refreshToken.update({ where: { id: sessionId }, data: { fcmToken: normalized } }),
    ]);
    return true;
  }

  async unregisterToken(userId: string, sessionId: string | undefined) {
    if (!sessionId) return false;
    const result = await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { fcmToken: null },
    });
    return result.count === 1;
  }

  async notifyChatMessage(recipientUserIds: string[], input: ChatPushInput) {
    return this.sendToUsers(recipientUserIds, (tokens) => chatPushMessage(tokens, input));
  }

  async notifyIncomingCall(recipientUserId: string, input: IncomingCallPushInput) {
    return this.sendToUsers([recipientUserId], (tokens) => incomingCallPushMessage(tokens, input));
  }

  private firebaseApp(): App | undefined {
    if (getApps().length) return getApps()[0];
    try {
      const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
      const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
      if (base64) {
        const account = JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as {
          project_id: string;
          client_email: string;
          private_key: string;
        };
        return initializeApp({
          credential: cert({
            projectId: account.project_id,
            clientEmail: account.client_email,
            privateKey: account.private_key,
          }),
          projectId: account.project_id,
        });
      }
      if (projectId && clientEmail && privateKey) {
        return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
      }
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
        return initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) });
      }
      return undefined;
    } catch (error) {
      this.logger.error(`Không khởi tạo được Firebase Admin: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private async sendToUsers(
    userIds: string[],
    buildMessage: (tokens: string[]) => MulticastMessage,
  ) {
    if (!this.messaging || !userIds.length) return { configured: Boolean(this.messaging), sent: 0, failed: 0 };
    const sessions = await this.prisma.refreshToken.findMany({
      where: {
        userId: { in: [...new Set(userIds)] },
        fcmToken: { not: null },
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { status: 'ACTIVE', inAppNotifications: true },
      },
      select: { fcmToken: true },
    });
    const tokens = [...new Set(sessions.map((row) => row.fcmToken).filter((token): token is string => Boolean(token)))];
    if (!tokens.length) return { configured: true, sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;
    const deadTokens: string[] = [];
    for (let offset = 0; offset < tokens.length; offset += 500) {
      const batch = tokens.slice(offset, offset + 500);
      try {
        const result = await this.messaging.sendEachForMulticast(buildMessage(batch));
        sent += result.successCount;
        failed += result.failureCount;
        result.responses.forEach((response, index) => {
          if (!response.success && isDeadFirebaseTarget(response.error?.code)) deadTokens.push(batch[index]);
        });
      } catch (error) {
        failed += batch.length;
        this.logger.warn(`Không gửi được FCM batch: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (deadTokens.length) {
      await this.prisma.refreshToken.updateMany({
        where: { fcmToken: { in: [...new Set(deadTokens)] } },
        data: { fcmToken: null },
      });
    }
    return { configured: true, sent, failed };
  }
}
