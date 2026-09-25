import { Global, Module } from '@nestjs/common';
import { PushNotificationService } from './push-notification.service';

@Global()
@Module({
  providers: [PushNotificationService],
  exports: [PushNotificationService],
})
export class PushNotificationModule {}
