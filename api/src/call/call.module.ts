import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { Phase1Module } from '../phase1/phase1.module';
import { AgoraService } from './agora.service';
import { CallController } from './call.controller';
import { CALL_TIMEOUT_QUEUE } from './call.constants';
import { CallProcessor } from './call.processor';
import { CallSignalingService } from './call-signaling.service';
import { CallService } from './call.service';

@Module({
  imports: [AuthModule, Phase1Module, BullModule.registerQueue({ name: CALL_TIMEOUT_QUEUE })],
  controllers: [CallController],
  providers: [AgoraService, CallSignalingService, CallService, CallProcessor],
})
export class CallModule {}
