import { loadEnvironment, type Environment } from '@splito/config';

export const APP_CONFIG = Symbol('APP_CONFIG');

export const appConfigProvider = {
  provide: APP_CONFIG,
  useFactory: (): Environment => loadEnvironment(),
};
