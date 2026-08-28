import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbOptions {
  readonly url: string;
  readonly max?: number;
  readonly statementTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly ssl?: boolean;
  readonly onnotice?: (notice: unknown) => void;
}

export interface DbHandle {
  readonly db: Database;
  readonly sql: Sql;
  close(): Promise<void>;
}

/**
 * Create a pooled connection.
 *
 * `statement_timeout` is set on the connection rather than per query: it is a
 * backstop for the query nobody remembered to bound, which is by definition
 * the one that will take the site down.
 */
export function createDb(opts: DbOptions): DbHandle {
  const sql = postgres(opts.url, {
    max: opts.max ?? 10,
    idle_timeout: 30,
    connect_timeout: Math.ceil((opts.connectTimeoutMs ?? 5_000) / 1000),
    ssl: opts.ssl === true ? 'require' : false,
    prepare: true,
    onnotice: opts.onnotice ?? (() => {}),
    connection: {
      statement_timeout: opts.statementTimeoutMs ?? 10_000,
      application_name: 'ipl-platform',
    },
    types: {
      // `bigint` columns arrive as strings by default so large values survive
      // the trip. Every bigint in this schema is a row id or a count that fits
      // comfortably in a JS number, so coerce at the edge instead of leaking
      // strings into arithmetic.
      bigint: postgres.BigInt,
    },
  });

  return {
    db: drizzle(sql, { schema, casing: 'snake_case' }),
    sql,
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

export { schema };
