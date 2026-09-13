import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ExpensesModule } from '../expenses/expenses.module.js';
import { SettlementsController } from './settlements.controller.js';
import { SettlementsRepository } from './settlements.repository.js';
import { SettlementsService } from './settlements.service.js';

@Module({
  imports: [AuthModule, ExpensesModule],
  controllers: [SettlementsController],
  providers: [SettlementsRepository, SettlementsService],
})
export class SettlementsModule {}
