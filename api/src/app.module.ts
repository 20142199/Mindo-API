import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AccountModule } from './account/account.module';
import { AuthModule } from './auth/auth.module';
import { CallModule } from './call/call.module';
import { PrismaModule } from './common/prisma.module';
import { FriendModule } from './friend/friend.module';
import { HistoryModule } from './history/history.module';
import { Phase1Module } from './phase1/phase1.module';
import { Phase2Module } from './phase2/phase2.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    PrismaModule,
    AuthModule,
    CallModule,
    FriendModule,
    Phase1Module,
    AccountModule,
    HistoryModule,
    Phase2Module,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
