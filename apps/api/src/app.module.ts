import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module.js';
import { BalancesModule } from './balances/balances.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import { OracleModule } from './database/oracle.module.js';
import { HealthModule } from './health/health.module.js';
import { GroupsModule } from './groups/groups.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { IdempotencyModule } from './idempotency/idempotency.module.js';
import { MediaModule } from './media/media.module.js';
import { SettlementsModule } from './settlements/settlements.module.js';

@Module({
  imports: [
    AppConfigModule,
    OracleModule,
    AccessModule,
    IdempotencyModule,
    HealthModule,
    AuthModule,
    GroupsModule,
    ExpensesModule,
    BalancesModule,
    SettlementsModule,
    MediaModule,
  ],
})
export class AppModule {}
