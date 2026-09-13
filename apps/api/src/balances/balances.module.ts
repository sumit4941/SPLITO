import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BalancesController, GroupBalancesController } from './balances.controller.js';
import { BalancesRepository } from './balances.repository.js';
import { BalancesService } from './balances.service.js';

@Module({
  imports: [AuthModule],
  controllers: [BalancesController, GroupBalancesController],
  providers: [BalancesRepository, BalancesService],
})
export class BalancesModule {}
