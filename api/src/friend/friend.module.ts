import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { Phase1Module } from '../phase1/phase1.module';
import { FriendController } from './friend.controller';
import { FriendService } from './friend.service';

@Module({
  imports: [AuthModule, ChatModule, Phase1Module],
  controllers: [FriendController],
  providers: [FriendService],
})
export class FriendModule {}
