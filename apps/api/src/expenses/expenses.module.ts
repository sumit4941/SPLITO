import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ExpensesController, GroupExpensesController } from './expenses.controller.js';
import { ExpensesRepository } from './expenses.repository.js';
import { ExpensesService } from './expenses.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ExpensesController, GroupExpensesController],
  providers: [ExpensesRepository, ExpensesService],
  exports: [ExpensesRepository],
})
export class ExpensesModule {}
