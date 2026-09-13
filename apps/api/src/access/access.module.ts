import { Global, Module } from '@nestjs/common';
import { ContextAccessRepository } from './context-access.repository.js';

@Global()
@Module({
  providers: [ContextAccessRepository],
  exports: [ContextAccessRepository],
})
export class AccessModule {}
