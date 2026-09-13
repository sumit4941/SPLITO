import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { Environment } from '@splito/config';
import oracledb, {
  type Connection,
  type BindParameters,
  type ExecuteOptions,
  type Pool,
  type Result,
} from 'oracledb';
import { APP_CONFIG } from '../config/app-config.js';

const SAFE_ORACLE_IDENTIFIER = /^[A-Z][A-Z0-9_$#]{0,29}$/;

@Injectable()
export class OracleService implements OnModuleInit, OnApplicationShutdown {
  #pool: Pool | undefined;

  constructor(@Inject(APP_CONFIG) private readonly config: Environment) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.DATABASE_PASSWORD) {
      throw new Error('DATABASE_PASSWORD is required to start the SPLITO API');
    }
    if (!SAFE_ORACLE_IDENTIFIER.test(this.config.DATABASE_OWNER_SCHEMA)) {
      throw new Error('DATABASE_OWNER_SCHEMA is not a safe Oracle identifier');
    }

    oracledb.fetchAsString = [oracledb.NUMBER];
    const ownerSchema = this.config.DATABASE_OWNER_SCHEMA;
    this.#pool = await oracledb.createPool({
      user: this.config.DATABASE_USER,
      password: this.config.DATABASE_PASSWORD,
      connectString: this.config.DATABASE_CONNECT_STRING,
      poolMin: this.config.DATABASE_POOL_MIN,
      poolMax: this.config.DATABASE_POOL_MAX,
      poolIncrement: this.config.DATABASE_POOL_INCREMENT,
      queueTimeout: this.config.DATABASE_QUEUE_TIMEOUT_MS,
      stmtCacheSize: 50,
      sessionCallback: (connection, _requestedTag, callback) => {
        void connection
          .execute(`ALTER SESSION SET CURRENT_SCHEMA = ${ownerSchema}`)
          .then(() => callback())
          .catch((error: unknown) =>
            callback(error instanceof Error ? error : new Error('Oracle session setup failed')),
          );
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.#pool) {
      await this.#pool.close(10);
      this.#pool = undefined;
    }
  }

  async withConnection<T>(operation: (connection: Connection) => Promise<T>): Promise<T> {
    const connection = await this.#getConnection();
    try {
      return await operation(connection);
    } finally {
      await connection.close();
    }
  }

  async withTransaction<T>(operation: (connection: Connection) => Promise<T>): Promise<T> {
    const connection = await this.#getConnection();
    try {
      const result = await operation(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.close();
    }
  }

  execute<T = unknown>(
    connection: Connection,
    sql: string,
    binds: BindParameters = {},
    options: ExecuteOptions = {},
  ): Promise<Result<T>> {
    return connection.execute<T>(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: false,
      ...options,
    });
  }

  async ping(): Promise<{ databaseVersion: string; currentSchema: string }> {
    return this.withConnection(async (connection) => {
      const result = await this.execute<{ DATABASE_VERSION: string; CURRENT_SCHEMA: string }>(
        connection,
        `SELECT VERSION_FULL AS DATABASE_VERSION,
                SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS CURRENT_SCHEMA
           FROM PRODUCT_COMPONENT_VERSION
          WHERE PRODUCT LIKE 'Oracle%Database%'
          FETCH FIRST 1 ROW ONLY`,
      );
      const row = result.rows?.[0];
      if (!row) throw new Error('Oracle readiness query returned no rows');
      return { databaseVersion: row.DATABASE_VERSION, currentSchema: row.CURRENT_SCHEMA };
    });
  }

  async #getConnection(): Promise<Connection> {
    if (!this.#pool) throw new Error('Oracle connection pool has not been initialized');
    const connection = await this.#pool.getConnection();
    connection.callTimeout = this.config.DATABASE_CALL_TIMEOUT_MS;
    return connection;
  }
}
