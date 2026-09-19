import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { Phase1Module } from '../phase1/phase1.module';
import { FriendController } from './friend.controller';
import { FriendService } from './friend.service';

@Module({
  imports: [AuthModule, Phase1Module],
  controllers: [FriendController],
  providers: [FriendService],
})
export class FriendModule {}
