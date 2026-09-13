import createClient from 'openapi-fetch';
import type { ClientOptions } from 'openapi-fetch';
import type { components, operations, paths } from './schema.js';

export type SplitoApiPaths = paths;
export type SplitoApiOperations = operations;
export type SplitoApiSchemas = components['schemas'];

export type SplitoUser = components['schemas']['User'];
export type SplitoGroup = components['schemas']['Group'];
export type SplitoGroupDetail = components['schemas']['GroupDetail'];
export type SplitoExpense = components['schemas']['Expense'];
export type SplitoBalanceLine = components['schemas']['BalanceLine'];
export type SplitoSplitPreview = components['schemas']['SplitPreview'];
export type SplitoSettlementPreview = components['schemas']['SettlementPreview'];

export function createSplitoClient(options: ClientOptions = {}) {
  return createClient<paths>(options);
}

export type { components, operations, paths } from './schema.js';
