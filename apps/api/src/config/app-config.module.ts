import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, appConfigProvider } from './app-config.js';

@Global()
@Module({
  providers: [appConfigProvider],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
