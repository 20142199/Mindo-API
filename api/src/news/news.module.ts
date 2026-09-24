import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminNewsController, NewsController } from './news.controller';
import { NewsService } from './news.service';
import { OptionalJwtGuard } from './optional-jwt.guard';

@Module({
  imports: [AuthModule],
  controllers: [NewsController, AdminNewsController],
  providers: [NewsService, OptionalJwtGuard],
})
export class NewsModule {}
