import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { MeController } from './me.controller.js';
import { SessionGuard } from './session.guard.js';

@Module({
  imports: [SmsModule],
  controllers: [AuthController, MeController],
  providers: [AuthRepository, AuthService, SessionGuard, CsrfGuard],
  exports: [AuthService, SessionGuard, CsrfGuard],
})
export class AuthModule {}
