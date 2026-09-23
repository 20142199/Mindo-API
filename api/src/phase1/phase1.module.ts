import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FileStorageService } from './file-storage.service';
import { Phase1Controller } from './phase1.controller';
import { Phase1Service } from './phase1.service';
import { VietQrService } from './vietqr.service';
import { VietQrController } from './vietqr.controller';
import { ReferralModule } from '../referral/referral.module';

@Module({
  imports: [AuthModule, ReferralModule],
  controllers: [Phase1Controller, VietQrController],
  providers: [Phase1Service, FileStorageService, VietQrService],
  exports: [FileStorageService],
})
export class Phase1Module {}
