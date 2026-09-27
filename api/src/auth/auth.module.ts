import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EmailService } from '../common/email.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { WebLoginController } from './web-login.controller';
import { WebLoginService } from './web-login.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, WebLoginController],
  providers: [AuthService, WebLoginService, JwtAuthGuard, EmailService],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
