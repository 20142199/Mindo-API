import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { Phase1Module } from '../phase1/phase1.module';
import { AgencyService } from './agency.service';
import { AiProcessor } from './ai.processor';
import { AiProviderService } from './ai-provider.service';
import { AiService } from './ai.service';
import { Phase2Controller } from './phase2.controller';

@Module({
  imports: [AuthModule, Phase1Module, BullModule.registerQueue({ name: 'ai-response' })],
  controllers: [Phase2Controller],
  providers: [AgencyService, AiProviderService, AiService, AiProcessor],
})
export class Phase2Module {}
