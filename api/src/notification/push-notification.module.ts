import { Global, Module } from '@nestjs/common';
import { PushNotificationService } from './push-notification.service';
import { TelegramNotificationService } from './telegram-notification.service';

@Global()
@Module({
  providers: [PushNotificationService, TelegramNotificationService],
  exports: [PushNotificationService, TelegramNotificationService],
})
export class PushNotificationModule {}
