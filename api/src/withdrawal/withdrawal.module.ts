import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { Phase1Module } from '../phase1/phase1.module';
import { WithdrawalController } from './withdrawal.controller';
import { WithdrawalService } from './withdrawal.service';

@Module({
  imports: [AuthModule, Phase1Module],
  controllers: [WithdrawalController],
  providers: [WithdrawalService],
})
export class WithdrawalModule {}
