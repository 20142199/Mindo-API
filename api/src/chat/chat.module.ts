import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { Phase1Module } from '../phase1/phase1.module';
import { ChatController } from './chat.controller';
import { ChatPresenceService } from './chat-presence.service';
import { ChatRealtimeService } from './chat-realtime.service';
import { ChatService } from './chat.service';

@Module({
  imports: [AuthModule, Phase1Module],
  controllers: [ChatController],
  providers: [ChatService, ChatPresenceService, ChatRealtimeService],
  exports: [ChatRealtimeService],
})
export class ChatModule {}
