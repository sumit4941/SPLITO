import { Global, Module } from '@nestjs/common';
import { OracleService } from './oracle.service.js';

@Global()
@Module({
  providers: [OracleService],
  exports: [OracleService],
})
export class OracleModule {}
