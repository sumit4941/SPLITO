import type { Db } from 'mongodb';

export type MongoRuntimeComponent = 'api' | 'worker';

export declare const MONGO_SCHEMA_DEFINITION_CHECKSUM: string;

export declare function managedIndexMatches(
  expected: Record<string, unknown>,
  actual: Record<string, unknown> | undefined,
): boolean;

export declare function assertMongoRuntimeReady(
  database: Db,
  component: MongoRuntimeComponent,
  options?: { readonly verifyManagedSchema?: boolean },
): Promise<void>;
